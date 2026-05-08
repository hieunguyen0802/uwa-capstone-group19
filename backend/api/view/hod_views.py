"""
HoD API (v3) — frontend contract `IntegrationLog/hod-hos-frontend-api.zh-en(1).md` §5.

Scope: list / detail / decision only. Reports/visualization/export live elsewhere.

Reuses `get_workload_queryset(staff)` so HoD-only department scoping is enforced
by a single source of truth. Legacy `/api/supervisor/*` endpoints remain intact
during cutover.
"""

from decimal import Decimal

from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from rest_framework import status as http_status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.decorators import require_role
from api.models import AuditLog, WorkloadItem, WorkloadReport
from api.services.workload_service import get_workload_queryset, stale_report_response_payload


CATEGORY_LABELS = {
    'TEACHING': 'Teaching',
    'ASSIGNED_ROLE': 'Assigned Roles',
    'HDR_SUPERVISION': 'HDR',
    'SERVICE': 'Service',
}
LABEL_TO_CATEGORY = {v: k for k, v in CATEGORY_LABELS.items()}


def _to_hours(value: Decimal) -> float:
    return float((value or Decimal('0.00')).quantize(Decimal('0.01')))


def _first(request_data, *keys, default=''):
    """Accept both camelCase and snake_case input during alignment window."""
    for k in keys:
        if k in request_data and request_data[k] not in (None, ''):
            return request_data[k]
    return default


def _get_request_reason(report):
    log = (
        AuditLog.objects.filter(report=report, changes__kind='WORKLOAD_REQUEST')
        .order_by('-created_at')
        .first()
    )
    return log.comment if log else ''


def _get_submitted_at(report):
    log = (
        AuditLog.objects.filter(report=report, changes__kind='WORKLOAD_REQUEST')
        .order_by('-created_at')
        .first()
    )
    return log.created_at.isoformat() if log else None


def _get_reviewer_note(report):
    log = (
        AuditLog.objects.filter(report=report, action_type__in=['APPROVE', 'REJECT'])
        .exclude(comment__isnull=True)
        .exclude(comment='')
        .order_by('-created_at')
        .first()
    )
    return log.comment if log else ''


def _serialize_breakdown(items):
    grouped = {'Teaching': [], 'Assigned Roles': [], 'HDR': [], 'Service': [], 'Research (residual)': []}
    for item in items:
        label = CATEGORY_LABELS.get(item.category)
        if label:
            grouped[label].append({
                'name': item.unit_code or item.description or item.category,
                'hours': _to_hours(item.allocated_hours),
            })
    return grouped


def _parse_breakdown(data):
    """Frontend-shaped breakdown dict → list[dict] for WorkloadItem create."""
    errors, parsed = [], []
    if not isinstance(data, dict):
        return parsed, ['breakdown must be an object']
    for label, rows in data.items():
        category = LABEL_TO_CATEGORY.get(label)
        if not category or not isinstance(rows, list):
            continue
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                errors.append(f'{label}[{idx}] must be an object')
                continue
            name = str(row.get('name', '')).strip()[:100]
            if not name:
                errors.append(f'{label}[{idx}].name is required')
                continue
            try:
                hours = Decimal(str(row.get('hours', 0)))
            except Exception:
                errors.append(f'{label}[{idx}].hours must be numeric')
                continue
            if hours < 0 or hours > Decimal('10000'):
                errors.append(f'{label}[{idx}].hours out of range')
                continue
            if category == 'TEACHING':
                parsed.append({'category': category, 'unit_code': name, 'description': None, 'allocated_hours': hours})
            else:
                parsed.append({'category': category, 'unit_code': None, 'description': name, 'allocated_hours': hours})
    return parsed, errors


def _hod_visible_qs(staff):
    """
    HoD queue visibility:
      PENDING / APPROVED / REJECTED always visible;
      INITIAL visible only when academic has already confirmed (read-only).
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
            Q(status__in=['PENDING', 'APPROVED', 'REJECTED'])
            | Q(status='INITIAL', is_confirmed=True)
        )
    )


def _sem_label(semester: str) -> str:
    return f'Sem{semester[-1]}' if semester and semester.startswith('S') else semester or ''


def _period_label(year, semester) -> str:
    if semester and semester.startswith('S'):
        return f'{year}-{semester[-1]}'
    return str(year or '')


def _serialize_row(report):
    items = list(report.items.all())
    staff_user = report.staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    total = sum((i.allocated_hours for i in items), Decimal('0.00'))
    return {
        'id': str(report.report_id),
        'sourceWorkloadId': str(report.report_id),
        'staffId': report.staff.staff_number,
        'name': full_name,
        'title': report.staff.title or '',
        'department': report.snapshot_department.name,
        'reason': _get_request_reason(report),
        'status': report.status.lower(),
        'totalWorkHours': _to_hours(total),
        'submittedAt': _get_submitted_at(report),
        'semesterLabel': _sem_label(report.semester),
        'periodLabel': _period_label(report.academic_year, report.semester),
        'isAnomaly': report.is_anomaly,
        # Optimistic-lock token placeholder. Current contract uses updated_at ISO;
        # strict ifVersion enforcement can be enabled later without renaming fields.
        'version': report.updated_at.isoformat() if report.updated_at else None,
    }


def _serialize_detail(report):
    items = list(report.items.all())
    staff = report.staff
    staff_user = staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    total_hours = sum((i.allocated_hours for i in items), Decimal('0.00'))

    # actualTeachingRatio: teaching hours / total hours, as percentage (0-100).
    teaching_hours = sum(
        (i.allocated_hours for i in items if i.category == 'TEACHING'),
        Decimal('0.00'),
    )
    actual_tr = 0.0
    if total_hours > 0:
        actual_tr = float((teaching_hours / total_hours * Decimal('100')).quantize(Decimal('0.01')))

    target_tr = (
        float(report.target_teaching_pct)
        if report.target_teaching_pct is not None
        else None
    )

    employment_map = {'FULL_TIME': 'Full-time', 'PART_TIME': 'Part-time', 'CASUAL': 'Casual'}

    return {
        'id': str(report.report_id),
        'staffId': staff.staff_number,
        'name': full_name,
        'title': staff.title or '',
        'department': report.snapshot_department.name,
        'periodLabel': _period_label(report.academic_year, report.semester),
        'targetTeachingRatio': target_tr,
        'actualTeachingRatio': actual_tr,
        'totalWorkHours': _to_hours(total_hours),
        'employmentType': employment_map.get(staff.employment_type, staff.employment_type),
        'isNewStaff': bool(staff.is_new_employee),
        # hodReviewRequired / schoolOperationsNotes are not modelled yet; exposed as defaults
        # so the frontend contract stays stable. Backed by real data once models catch up.
        'hodReviewRequired': False,
        'schoolOperationsNotes': staff.notes or '',
        'applicationReason': _get_request_reason(report),
        'status': report.status.lower(),
        'breakdown': _serialize_breakdown(items),
        'canEditBreakdown': report.status == 'PENDING',
        'cancelled': False,
        'reviewerNote': _get_reviewer_note(report),
        'isAnomaly': report.is_anomaly,
        'version': report.updated_at.isoformat() if report.updated_at else None,
    }


# ─── GET /api/hod/workload-requests/ ────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD')
def hod_workload_requests(request):
    base_qs = _hod_visible_qs(request.staff)
    qs = base_qs.prefetch_related('items').select_related('staff__user', 'snapshot_department')

    status_filter = (request.GET.get('status') or 'all').lower()
    if status_filter != 'all':
        qs = qs.filter(status=status_filter.upper())

    name = (request.GET.get('name') or '').strip()
    if name:
        qs = qs.filter(
            Q(staff__user__first_name__icontains=name)
            | Q(staff__user__last_name__icontains=name)
        )

    staff_id = (request.GET.get('staffId') or request.GET.get('staff_id') or '').strip()
    if staff_id:
        qs = qs.filter(staff__staff_number__icontains=staff_id)

    year = (request.GET.get('year') or '').strip()
    if year:
        try:
            qs = qs.filter(academic_year=int(year))
        except ValueError:
            pass

    semester = (request.GET.get('semester') or '').strip()
    if semester:
        qs = qs.filter(semester=semester.upper())

    qs = qs.order_by('-updated_at')

    try:
        page = max(1, int(request.GET.get('page', 1)))
        page_size = max(1, min(100, int(request.GET.get('pageSize') or request.GET.get('page_size') or 10)))
    except (TypeError, ValueError):
        return Response(
            {'success': False, 'message': 'page and pageSize must be positive integers'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    rows = [_serialize_row(r) for r in qs]
    paginator = Paginator(rows, page_size)
    current = paginator.get_page(page)

    return Response({
        'items': list(current.object_list),
        'page': current.number,
        'pageSize': page_size,
        'total': paginator.count,
        'summary': {
            'pending': base_qs.filter(status='PENDING').count(),
            'approved': base_qs.filter(status='APPROVED').count(),
            'rejected': base_qs.filter(status='REJECTED').count(),
        },
    })


# ─── GET /api/hod/workload-requests/{id}/ ───────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD')
def hod_workload_request_detail(request, id):
    qs = _hod_visible_qs(request.staff).prefetch_related('items').select_related(
        'staff__user', 'snapshot_department'
    )
    report = get_object_or_404(qs, report_id=id)
    return Response(_serialize_detail(report))


# ─── POST /api/hod/workload-requests/{id}/decision/ ─────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOD')
@transaction.atomic
def hod_workload_request_decision(request, id):
    """
    Accepts { decision: approve|reject, note, breakdown?, ifVersion? }.

    ifVersion is accepted but not enforced yet. Later strict validation can be
    wired without changing the request shape.
    """
    data = request.data or {}
    decision = str(_first(data, 'decision')).strip().lower()
    note = str(_first(data, 'note')).strip()
    breakdown = data.get('breakdown')
    if_version = _first(data, 'ifVersion', 'if_version', default=None)

    if decision not in ('approve', 'reject'):
        return Response(
            {'success': False, 'message': 'decision must be approve or reject'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    if not note:
        return Response(
            {'success': False, 'message': 'note is required'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    if len(note) > 240:
        return Response(
            {'success': False, 'message': 'note must be <= 240 characters'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    qs = _hod_visible_qs(request.staff)
    report = qs.filter(report_id=id).first()
    if report is None:
        stale = WorkloadReport.objects.filter(report_id=id, is_current=False).first()
        if stale is not None:
            return Response(stale_report_response_payload(), status=http_status.HTTP_409_CONFLICT)
        return Response(
            {'success': False, 'message': 'Report not found'},
            status=http_status.HTTP_404_NOT_FOUND,
        )

    if report.status != 'PENDING':
        return Response(
            {'success': False, 'message': f"Report status is '{report.status}', must be PENDING"},
            status=http_status.HTTP_409_CONFLICT,
        )

    if breakdown is not None:
        parsed, errs = _parse_breakdown(breakdown)
        if errs:
            return Response(
                {'success': False, 'message': 'Validation failed', 'errors': {'breakdown': errs}},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if not parsed:
            return Response(
                {'success': False, 'message': 'breakdown must contain at least one valid row'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        report.items.all().delete()
        WorkloadItem.objects.bulk_create([WorkloadItem(report=report, **kw) for kw in parsed])

    action_type = 'APPROVE' if decision == 'approve' else 'REJECT'
    new_status = 'APPROVED' if decision == 'approve' else 'REJECTED'
    report.status = new_status
    report.save(update_fields=['status', 'updated_at'])

    audit_changes = {'kind': 'HOD_DECISION', 'decision': decision}
    if if_version is not None:
        audit_changes['client_if_version'] = str(if_version)
    AuditLog.objects.create(
        report=report,
        action_by=request.staff,
        action_type=action_type,
        comment=note,
        changes=audit_changes,
    )

    staff_user = request.staff.user
    reviewer_name = staff_user.get_full_name().strip() or staff_user.username
    report.refresh_from_db(fields=['updated_at'])
    return Response({
        'id': str(report.report_id),
        'status': new_status.lower(),
        'reviewedBy': {
            'staffId': request.staff.staff_number,
            'name': reviewer_name,
        },
        'reviewedAt': report.updated_at.isoformat() if report.updated_at else None,
        'note': note,
        'version': report.updated_at.isoformat() if report.updated_at else None,
    })
