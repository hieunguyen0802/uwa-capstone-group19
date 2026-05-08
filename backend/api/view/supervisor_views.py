import io
from datetime import date
from decimal import Decimal

from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status as http_status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.decorators import require_role
from api.models import AuditLog, WorkloadItem
from api.services.audit_service import (
    compute_workload_item_diffs,
    snapshot_workload_items,
    write_audit,
)
from api.services.workload_service import (
    get_workload_queryset,
    _parse_year_range,
    _filter_reports_by_range,
    _build_semester_label,
    _reporting_period_label,
)

CATEGORY_LABELS = {
    'TEACHING': 'Teaching',
    'ASSIGNED_ROLE': 'Assigned Roles',
    'HDR_SUPERVISION': 'HDR',
    'SERVICE': 'Service',
}
LABEL_TO_CATEGORY = {v: k for k, v in CATEGORY_LABELS.items()}


# ─── Private helpers ──────────────────────────────────────────────────────────

def _to_decimal_hours(value: Decimal) -> float:
    return float(value.quantize(Decimal('0.01')))


def _get_request_reason(report):
    """Return the reason academic gave when submitting this report."""
    log = AuditLog.objects.filter(
        report=report,
        changes__kind='WORKLOAD_REQUEST',
    ).order_by('-created_at').first()
    return log.comment if log else ''


def _get_submitted_time(report):
    """Return the timestamp when academic submitted this report."""
    log = AuditLog.objects.filter(
        report=report,
        changes__kind='WORKLOAD_REQUEST',
    ).order_by('-created_at').first()
    return log.created_at.strftime('%Y-%m-%d %H:%M') if log else ''


def _get_supervisor_note(report):
    """Return the most recent HOD approve/reject comment."""
    log = (
        AuditLog.objects.filter(report=report, action_type__in=['APPROVE', 'REJECT'])
        .exclude(comment__isnull=True).exclude(comment='')
        .order_by('-created_at').first()
    )
    return log.comment if log else ''


def _serialize_breakdown(items):
    grouped = {'Teaching': [], 'Assigned Roles': [], 'HDR': [], 'Service': []}
    for item in items:
        label = CATEGORY_LABELS.get(item.category)
        if label:
            grouped[label].append({
                'name': item.unit_code or item.description or item.category,
                'hours': _to_decimal_hours(item.allocated_hours),
            })
    return grouped


def _serialize_report_row(report, items):
    staff_user = report.staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    total_hours = sum((i.allocated_hours for i in items), Decimal('0.00'))
    first_teaching = next((i for i in items if i.category == 'TEACHING' and i.unit_code), None)
    first_desc = next((i for i in items if i.description), None)
    sem = report.semester
    sem_label = f"Sem{sem[-1]}" if sem.startswith('S') else sem
    period_label = f"{report.academic_year}-{sem[-1]}" if sem.startswith('S') else str(report.academic_year)

    return {
        'id': str(report.report_id),
        'employee_id': report.staff.staff_number,
        'name': full_name,
        'title': '',
        'department': report.snapshot_department.name,
        'unit': first_teaching.unit_code if first_teaching else '',
        'description': first_desc.description if first_desc else '',
        'request_reason': _get_request_reason(report),
        'status': report.status.lower(),
        'total_hours': _to_decimal_hours(total_hours),
        'submitted_time': _get_submitted_time(report),
        'semester_label': sem_label,
        'period_label': period_label,
        'is_anomaly': report.is_anomaly,
    }


def _parse_breakdown_data(breakdown_data):
    """Convert frontend breakdown dict to list of dicts for WorkloadItem creation."""
    result = []
    errors = []
    for label, rows in breakdown_data.items():
        category = LABEL_TO_CATEGORY.get(label)
        if not category:
            continue
        if not isinstance(rows, list):
            errors.append(f'{label} must be a list')
            continue
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                errors.append(f'{label}[{idx}] must be an object')
                continue

            name = str(row.get('name', '')).strip()[:100]  # cap at model field limit
            if not name:
                errors.append(f'{label}[{idx}].name is required')
                continue

            try:
                hours = Decimal(str(row.get('hours', 0)))
            except Exception:
                errors.append(f'{label}[{idx}].hours must be numeric')
                continue

            # Reject negative or implausibly large values.
            if hours < Decimal('0') or hours > Decimal('10000'):
                errors.append(f'{label}[{idx}].hours out of range')
                continue

            if category == 'TEACHING':
                result.append({'category': category, 'unit_code': name, 'description': None, 'allocated_hours': hours})
            else:
                result.append({'category': category, 'unit_code': None, 'description': name, 'allocated_hours': hours})
    return result, errors


def _hod_visible_qs(staff):
    """
    Returns the queryset of reports visible to HOD.

    Visibility rules:
      - PENDING / APPROVED / REJECTED: always visible
      - INITIAL + academic has confirmed: visible (read-only, HOD cannot act)
      - INITIAL + not yet confirmed: NOT visible
    """
    confirmed_subq = AuditLog.objects.filter(
        report=OuterRef('pk'),
        changes__kind='CONFIRMATION',
        changes__confirmation='confirmed',
    )
    return (
        get_workload_queryset(staff)
        .annotate(is_confirmed=Exists(confirmed_subq))
        .filter(
            Q(status__in=['PENDING', 'APPROVED', 'REJECTED']) |
            Q(status='INITIAL', is_confirmed=True)
        )
    )


# ─── 8.3 GET /supervisor/workload-requests/ ───────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def supervisor_workload_requests(request):
    """GET /api/supervisor/workload-requests/"""
    # base_qs: all reports HOD is allowed to see (confirmed INITIAL + submitted)
    base_qs = _hod_visible_qs(request.staff)
    qs = base_qs.prefetch_related('items').select_related('staff__user', 'snapshot_department')

    status_filter = (request.GET.get('status') or 'all').lower()
    if status_filter == 'initial':
        # Only show INITIAL+confirmed (visible but not yet submitted to HOD)
        qs = qs.filter(status='INITIAL')
    elif status_filter != 'all':
        qs = qs.filter(status=status_filter.upper())

    employee_id = request.GET.get('employee_id', '').strip()
    if employee_id:
        qs = qs.filter(staff__staff_number=employee_id)

    first_name = request.GET.get('first_name', '').strip()
    if first_name:
        qs = qs.filter(staff__user__first_name__icontains=first_name)

    last_name = request.GET.get('last_name', '').strip()
    if last_name:
        qs = qs.filter(staff__user__last_name__icontains=last_name)

    year = request.GET.get('year', '').strip()
    if year:
        qs = qs.filter(academic_year=year)

    semester = request.GET.get('semester', '').strip()
    if semester:
        qs = qs.filter(semester=semester.upper())

    qs = qs.order_by('-updated_at')

    # Summary only counts actionable states (INITIAL is read-only for HOD)
    summary = {
        'pending': base_qs.filter(status='PENDING').count(),
        'approved': base_qs.filter(status='APPROVED').count(),
        'rejected': base_qs.filter(status='REJECTED').count(),
    }

    try:
        page = max(1, int(request.GET.get('page', 1)))
        page_size = max(1, min(100, int(request.GET.get('page_size', 10))))
    except (ValueError, TypeError):
        return Response(
            {'success': False, 'message': 'page and page_size must be positive integers'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    rows = [_serialize_report_row(r, list(r.items.all())) for r in qs]
    paginator = Paginator(rows, page_size)
    current_page = paginator.get_page(page)

    return Response({
        'success': True,
        'message': 'Supervisor workload requests loaded',
        'data': {
            'summary': summary,
            'page': current_page.number,
            'page_size': page_size,
            'total': paginator.count,
            'items': list(current_page.object_list),
        },
    })


# ─── 8.4 GET /supervisor/workload-requests/{id}/ ─────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def supervisor_workload_request_detail(request, id):
    """GET /api/supervisor/workload-requests/{id}/"""
    qs = _hod_visible_qs(request.staff).prefetch_related('items').select_related(
        'staff__user', 'snapshot_department'
    )
    report = get_object_or_404(qs, report_id=id)
    items = list(report.items.all())
    staff_user = report.staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    total_hours = sum((i.allocated_hours for i in items), Decimal('0.00'))
    first_desc = next((i for i in items if i.description), None)

    return Response({
        'success': True,
        'message': 'Request detail loaded',
        'data': {
            'id': str(report.report_id),
            'employee_id': report.staff.staff_number,
            'name': full_name,
            'title': '',
            'department': report.snapshot_department.name,
            'status': report.status.lower(),
            'total_hours': _to_decimal_hours(total_hours),
            'request_reason': _get_request_reason(report),
            'description': first_desc.description if first_desc else '',
            'supervisor_note': _get_supervisor_note(report),
            'is_anomaly': report.is_anomaly,
            'breakdown': _serialize_breakdown(items),
        },
    })


# ─── 8.5 POST /supervisor/workload-requests/batch-decision/ ──────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
@transaction.atomic
def supervisor_batch_decision(request):
    """POST /api/supervisor/workload-requests/batch-decision/"""
    request_ids = request.data.get('request_ids') or []
    decision = (request.data.get('decision') or '').lower()

    if not isinstance(request_ids, list) or not request_ids:
        return Response(
            {'success': False, 'message': 'Validation failed',
             'errors': {'request_ids': ['At least one id is required']}},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if len(request_ids) > 100:
        return Response(
            {'success': False, 'message': 'Validation failed',
             'errors': {'request_ids': ['Cannot process more than 100 ids at once']}},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if decision not in ('approved', 'rejected'):
        return Response(
            {'success': False, 'message': 'Validation failed',
             'errors': {'decision': ['Must be approved or rejected']}},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    qs = _hod_visible_qs(request.staff)
    reports = list(qs.filter(report_id__in=request_ids))

    if len(reports) != len(request_ids):
        return Response(
            {'success': False, 'message': 'One or more request ids are invalid or not accessible'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    non_pending = [r for r in reports if r.status != 'PENDING']
    if non_pending:
        return Response(
            {'success': False, 'message': 'One or more requests are not in PENDING status',
             'errors': {'request_ids': [str(r.report_id) for r in non_pending]}},
            status=http_status.HTTP_409_CONFLICT,
        )

    action_type = 'APPROVE' if decision == 'approved' else 'REJECT'
    new_status = decision.upper()
    for report in reports:
        report.status = new_status
        report.save(update_fields=['status', 'updated_at'])
        AuditLog.objects.create(report=report, action_by=request.staff, action_type=action_type)

    return Response({
        'success': True,
        'message': 'Batch decision completed',
        'data': {'updated_count': len(reports), 'decision': decision},
    })


# ─── 8.6 POST /supervisor/workload-requests/{id}/decision/ ───────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
@transaction.atomic
def supervisor_single_decision(request, id):
    """POST /api/supervisor/workload-requests/{id}/decision/"""
    decision = (request.data.get('decision') or '').lower()
    note = (request.data.get('note') or '').strip()
    breakdown_data = request.data.get('breakdown')

    if decision not in ('approved', 'rejected'):
        return Response(
            {'success': False, 'message': 'Validation failed',
             'errors': {'decision': ['Must be approved or rejected']}},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if not note:
        return Response(
            {'success': False, 'message': 'Validation failed',
             'errors': {'note': ['note is required']}},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if len(note) > 240:
        return Response(
            {'success': False, 'message': 'Validation failed',
             'errors': {'note': ['note must be <= 240 characters']}},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    qs = _hod_visible_qs(request.staff)
    report = get_object_or_404(qs, report_id=id)

    if report.status != 'PENDING':
        return Response(
            {'success': False, 'message': f"Report status is '{report.status}', must be PENDING"},
            status=http_status.HTTP_409_CONFLICT,
        )

    # Optional breakdown update: replace all items with the provided data.
    # Snapshot BEFORE delete — once rows are gone the before-state cannot be recovered.
    workload_edit_diffs = None
    if breakdown_data and isinstance(breakdown_data, dict):
        parsed, parse_errors = _parse_breakdown_data(breakdown_data)
        if parse_errors:
            return Response(
                {'success': False, 'message': 'Validation failed', 'errors': {'breakdown': parse_errors}},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if not parsed:
            return Response(
                {'success': False, 'message': 'Validation failed',
                 'errors': {'breakdown': ['At least one valid breakdown row is required']}},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        before_snapshot = snapshot_workload_items(report.items.all())
        report.items.all().delete()
        WorkloadItem.objects.bulk_create([
            WorkloadItem(report=report, **kwargs) for kwargs in parsed
        ])
        after_snapshot = snapshot_workload_items(report.items.all())
        workload_edit_diffs = compute_workload_item_diffs(before_snapshot, after_snapshot)

    # Audit breakdown edits separately from the approve/reject decision so the
    # history timeline shows them as distinct events.
    if workload_edit_diffs:
        write_audit(
            action_type='WORKLOAD_EDIT',
            action_by=request.staff,
            report=report,
            source='HOD_BREAKDOWN_EDIT',
            diffs=workload_edit_diffs,
        )

    action_type = 'APPROVE' if decision == 'approved' else 'REJECT'
    report.status = decision.upper()
    report.save(update_fields=['status', 'updated_at'])
    AuditLog.objects.create(report=report, action_by=request.staff, action_type=action_type, comment=note)

    return Response({
        'success': True,
        'message': 'Request updated',
        'data': {
            'id': str(report.report_id),
            'status': decision,
            'supervisor_note': note,
        },
    })


# ─── 8.7 GET /supervisor/visualization/ ──────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def supervisor_visualization(request):
    """GET /api/supervisor/visualization/"""
    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')

    qs = get_workload_queryset(request.staff).prefetch_related('items')
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter)
    qs_submitted = qs.exclude(status='INITIAL')

    reports = list(qs_submitted.order_by('academic_year', 'semester'))

    # Summary counts
    total_academics = qs_submitted.values('staff').distinct().count()
    pending_count = qs_submitted.filter(status='PENDING').count()
    approved_count = qs_submitted.filter(status='APPROVED').count()
    rejected_count = qs_submitted.filter(status='REJECTED').count()

    # Build ordered (year, semester) buckets
    SEM_ORDER = {'S1': 0, 'S2': 1, 'FULL_YEAR': 2}
    seen = {}
    for r in reports:
        seen[(r.academic_year, r.semester)] = True
    ordered_keys = sorted(seen.keys(), key=lambda k: (k[0], SEM_ORDER.get(k[1], 9)))

    # Aggregate total hours and staff count per bucket
    bucket_hours = {}   # key -> total hours (Decimal)
    bucket_staff = {}   # key -> set of staff_ids
    for r in reports:
        key = (r.academic_year, r.semester)
        total = sum(i.allocated_hours for i in r.items.all())
        bucket_hours[key] = bucket_hours.get(key, Decimal('0.00')) + total
        bucket_staff.setdefault(key, set()).add(r.staff_id)

    total_work_hours = float(round(sum(bucket_hours.values()), 2))
    work_hours_per_academic = round(total_work_hours / total_academics, 2) if total_academics else 0.0

    total_trend = []
    avg_trend = []
    for key in ordered_keys:
        label = _build_semester_label(*key)
        h = float(round(bucket_hours.get(key, Decimal('0.00')), 2))
        staff_count = len(bucket_staff.get(key, set()))
        avg_h = round(h / staff_count, 2) if staff_count else 0.0
        total_trend.append({'semester': label, 'total_hours': h})
        avg_trend.append({'semester': label, 'average_hours': avg_h})

    return Response({
        'success': True,
        'message': 'Supervisor visualization loaded',
        'data': {
            'reporting_period_label': _reporting_period_label(year_from, year_to, semester_filter),
            'summary': {
                'total_academics': total_academics,
                'total_work_hours': total_work_hours,
                'work_hours_per_academic': work_hours_per_academic,
                'pending_requests': pending_count,
                'approved_requests': approved_count,
                'rejected_requests': rejected_count,
            },
            'total_work_hours_trend': total_trend,
            'average_work_hours_by_semester': avg_trend,
        },
    })


# ─── 8.8 GET /supervisor/export/ ─────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def supervisor_export(request):
    """GET /api/supervisor/export/"""
    try:
        import openpyxl
    except ImportError:
        return Response(
            {'success': False, 'message': 'Export unavailable: openpyxl not installed'},
            status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')

    qs = (
        get_workload_queryset(request.staff)
        .prefetch_related('items')
        .select_related('staff__user', 'snapshot_department')
        .filter(status='APPROVED')
        .order_by('snapshot_department__name', 'staff__staff_number', 'academic_year', 'semester')
    )
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Supervisor Export'
    ws.append([
        'Staff Number', 'Name', 'Department', 'Academic Year', 'Semester',
        'Category', 'Unit Code', 'Description', 'Hours', 'Status', 'Export Date',
    ])

    export_date = date.today().isoformat()
    for report in qs:
        staff_user = report.staff.user
        name = staff_user.get_full_name().strip() or staff_user.username
        dept = report.snapshot_department.name
        items = list(report.items.all())
        if not items:
            ws.append([
                report.staff.staff_number, name, dept,
                report.academic_year, report.semester,
                '', '', '', 0, report.status.lower(), export_date,
            ])
        else:
            for item in items:
                ws.append([
                    report.staff.staff_number, name, dept,
                    report.academic_year, report.semester,
                    item.category, item.unit_code or '', item.description or '',
                    float(item.allocated_hours), report.status.lower(), export_date,
                ])

    file_name = f"Supervisor_Workload_{export_date}.xlsx"
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="{file_name}"'
    return response


# ─── Legacy endpoints (kept for backward compatibility) ───────────────────────

def _serialize_report(r):
    return {
        'report_id': str(r.report_id),
        'staff_number': r.staff.staff_number,
        'academic_year': r.academic_year,
        'semester': r.semester,
        'status': r.status,
        'is_anomaly': r.is_anomaly,
        'created_at': r.created_at.strftime('%Y-%m-%d %H:%M') if r.created_at else None,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def supervisor_requests(request):
    """Return workload reports grouped by status, scoped to the caller's role."""
    # Reuse v2 visibility rules for legacy endpoint to avoid leaking
    # INITIAL reports that are still unconfirmed by academic.
    qs = _hod_visible_qs(request.staff).order_by('-created_at')
    return Response({
        'initial': [_serialize_report(r) for r in qs.filter(status='INITIAL')],
        'pending': [_serialize_report(r) for r in qs.filter(status='PENDING')],
        'approved': [_serialize_report(r) for r in qs.filter(status='APPROVED')],
        'history': [_serialize_report(r) for r in qs.exclude(status__in=['INITIAL', 'PENDING'])],
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
@transaction.atomic
def approve_request(request, id):
    qs = get_workload_queryset(request.staff)
    report = get_object_or_404(qs, report_id=id)
    if report.status != 'PENDING':
        return Response(
            {'code': 'CONFLICT', 'message': f"Report status is '{report.status}', must be PENDING to approve."},
            status=409,
        )
    report.status = 'APPROVED'
    report.save()
    AuditLog.objects.create(report=report, action_by=request.staff, action_type='APPROVE')
    return Response({'message': 'Approved', 'report_id': str(report.report_id)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
@transaction.atomic
def reject_request(request, id):
    comment = request.data.get('comment', '').strip()
    if not comment:
        return Response(
            {'code': 'VALIDATION_ERROR', 'message': 'comment is required when rejecting.'},
            status=422,
        )
    qs = get_workload_queryset(request.staff)
    report = get_object_or_404(qs, report_id=id)
    if report.status != 'PENDING':
        return Response(
            {'code': 'CONFLICT', 'message': f"Report status is '{report.status}', must be PENDING to reject."},
            status=409,
        )
    report.status = 'REJECTED'
    report.save()
    AuditLog.objects.create(report=report, action_by=request.staff, action_type='REJECT', comment=comment)
    return Response({'message': 'Rejected', 'report_id': str(report.report_id)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def get_pending_requests(request):
    qs = get_workload_queryset(request.staff).filter(status='PENDING').order_by('-created_at')
    return Response([_serialize_report(r) for r in qs])


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def get_my_workloads(request):
    qs = get_workload_queryset(request.staff).order_by('-created_at')[:20]
    return Response([_serialize_report(r) for r in qs])


# ─── Change history timeline for a single report ─────────────────────────────

# Maps internal AuditLog.action_type to a UI-friendly label. Keep in sync with
# the ACTION_CHOICES list in models.py — if a new action_type is added there,
# add its label here so the frontend displays it correctly.
_ACTION_LABELS = {
    'IMPORTED': 'Imported from Excel',
    'MODIFIED_BY_REIMPORT': 'Superseded by re-import',
    'IMPORT_SKIP': 'Import skipped (protected)',
    'APPROVE': 'Approved',
    'REJECT': 'Rejected',
    'CONFIRMATION': 'Confirmed by academic',
    'SUBMIT_REQUEST': 'Approval request submitted',
    'WORKLOAD_EDIT': 'Workload edited',
    'PROFILE_EDIT': 'Profile edited',
    'COMMENT': 'Commented',
    'CONFIG_CHANGE': 'System config changed',
}


def _can_view_report_history(staff, report) -> bool:
    """Check that `staff` is allowed to see the audit history of `report`.

    History must include superseded (is_current=False) versions, so we cannot
    reuse the is_current-filtered get_workload_queryset here — write the
    visibility rule explicitly instead.
    """
    if staff.role in ('SCHOOL_OPS', 'HOS'):
        return True
    if staff.role == 'HOD':
        return report.snapshot_department_id == staff.department_id
    if staff.role == 'ACADEMIC':
        return report.staff_id == staff.staff_id
    return False


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC', 'HOD', 'SCHOOL_OPS', 'HOS')
def report_history(request, id):
    """GET /api/reports/{id}/history

    Returns the audit trail for a single WorkloadReport, newest first.
    Visible to ACADEMIC (own), HOD (own department), SCHOOL_OPS/HOS (all).

    When a report has been superseded by a reimport, the change chain is split
    across multiple WorkloadReport rows (old ones have is_current=False and
    point at their successor via superseded_by). We walk that chain and merge
    AuditLog rows from every version so "full audit trail" holds after reimport.

    Response shape is frozen in IntegrationLog/changehistory+.md §5.5 — the
    frontend renders a single diff component against this shape.
    """
    from api.models import WorkloadReport

    report = get_object_or_404(
        WorkloadReport.objects.select_related('snapshot_department', 'staff'),
        report_id=id,
    )
    if not _can_view_report_history(request.staff, report):
        return Response(
            {'success': False, 'message': 'Not permitted'},
            status=http_status.HTTP_403_FORBIDDEN,
        )

    # Collect every WorkloadReport version for this staff+period. The chain is
    # only linear today but we guard with a visited set so a cycle (should never
    # occur in production) cannot hang the request.
    chain_ids: set = {report.report_id}
    frontier = {report.report_id}
    for _ in range(50):  # hard cap; reimport chains never approach this in practice
        predecessors = set(
            WorkloadReport.objects
            .filter(superseded_by_id__in=frontier)
            .exclude(report_id__in=chain_ids)
            .values_list('report_id', flat=True)
        )
        if not predecessors:
            break
        chain_ids |= predecessors
        frontier = predecessors

    logs = (
        AuditLog.objects
        .filter(report_id__in=chain_ids)
        .select_related('action_by__user')
        .order_by('-created_at')[:200]
    )

    items = []
    for log in logs:
        actor_user = log.action_by.user if log.action_by else None
        actor_name = (
            (actor_user.get_full_name().strip() or actor_user.username)
            if actor_user else 'System'
        )
        actor_role = log.action_by.role if log.action_by else ''
        changes = log.changes or {}
        items.append({
            'timestamp': log.created_at.isoformat(),
            'actor': actor_name,
            'actor_role': actor_role,
            'action_type': log.action_type,
            'action_label': _ACTION_LABELS.get(log.action_type, log.action_type),
            'source': changes.get('source', ''),
            'comment': log.comment,
            'diffs': changes.get('diffs', []),
        })

    return Response({
        'success': True,
        'message': 'Report history loaded',
        'data': {'items': items},
    })
