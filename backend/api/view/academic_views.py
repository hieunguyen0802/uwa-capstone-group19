import io
import uuid
from datetime import date
from decimal import Decimal

from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.decorators import require_role
from api.models import AuditLog, WorkloadItem, WorkloadReport
from api.services.workload_service import (
    evaluate_mvp_anomaly,
    get_workload_queryset,
    persist_report_anomaly,
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


def _to_decimal_hours(value: Decimal) -> float:
    return float(value.quantize(Decimal('0.01')))


def _get_confirmation_map(report_ids):
    if not report_ids:
        return {}

    logs = AuditLog.objects.filter(
        report_id__in=report_ids,
        changes__kind='CONFIRMATION',
    ).order_by('-created_at')

    confirmation_map = {}
    for log in logs:
        rid = str(log.report_id)
        if rid in confirmation_map:
            continue
        confirmation_map[rid] = log.changes.get('confirmation', 'unconfirmed')
    return confirmation_map


def _get_report_confirmation(report):
    log = AuditLog.objects.filter(
        report=report,
        changes__kind='CONFIRMATION',
    ).order_by('-created_at').first()
    if not log:
        return 'unconfirmed'
    return log.changes.get('confirmation', 'unconfirmed')


def _get_confirmation_time(report):
    log = AuditLog.objects.filter(
        report=report,
        changes__kind='CONFIRMATION',
        changes__confirmation='confirmed',
    ).order_by('-created_at').first()
    if not log:
        return None
    return log.created_at.strftime('%Y-%m-%d %H:%M')


def _build_department_conflict_keys(reports):
    key_dept_map = {}
    for report in reports:
        key = (report.staff_id, report.academic_year, report.semester)
        key_dept_map.setdefault(key, set()).add(report.snapshot_department_id)
    return {key for key, dept_ids in key_dept_map.items() if len(dept_ids) > 1}


def _is_department_conflict(report):
    """Return True if this staff member has reports in multiple departments for the same period."""
    dept_count = (
        WorkloadReport.objects.filter(
            staff=report.staff,
            academic_year=report.academic_year,
            semester=report.semester,
            is_current=True,
        )
        .values('snapshot_department')
        .distinct()
        .count()
    )
    return dept_count > 1


def _get_supervisor_note(report):
    note_log = AuditLog.objects.filter(
        report=report,
        action_type__in=['APPROVE', 'REJECT'],
    ).exclude(comment__isnull=True).exclude(comment='').order_by('-created_at').first()
    return note_log.comment if note_log else ''


def _get_assigned_by(report):
    """Return the name of the SCHOOL_OPS staff who imported this report."""
    log = AuditLog.objects.filter(
        report=report,
        action_type__in=['IMPORTED', 'MODIFIED_BY_REIMPORT'],
    ).select_related('action_by__user').order_by('-created_at').first()
    if not log or not log.action_by:
        return ''
    return log.action_by.user.get_full_name().strip() or log.action_by.user.username


def _calc_target_teaching_hours(report) -> float:
    """Derive target teaching hours from target_teaching_pct × FTE × 1725 hrs/year."""
    if report.target_teaching_pct is None or report.snapshot_fte is None:
        return 0.0
    annual_hrs = float(report.snapshot_fte) * 100 * 17.25
    return round(annual_hrs * float(report.target_teaching_pct) / 100, 2)


def _calc_actual_teaching_ratio(report_items) -> float:
    """Actual teaching hours / total hours, as a percentage."""
    total = sum(i.allocated_hours for i in report_items)
    if not total:
        return 0.0
    teaching = sum(i.allocated_hours for i in report_items if i.category == 'TEACHING')
    return round(float(teaching / total) * 100, 1)


def _serialize_workload_row(report, confirmation, anomaly_result=None, report_items=None):
    """Serialize a WorkloadReport to the v3 list-item shape."""
    staff_user = report.staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    items = report_items if report_items is not None else list(report.items.all())
    total_hours = sum((item.allocated_hours for item in items), Decimal('0.00'))

    if anomaly_result is None:
        anomaly_result = {'is_anomaly': report.is_anomaly, 'reasons': []}

    return {
        'id': str(report.report_id),
        'name': full_name,
        'employeeId': report.staff.staff_number,
        'title': '',
        'notes': _get_supervisor_note(report),
        'hours': _to_decimal_hours(total_hours),
        'targetTeachingRatio': float(report.target_teaching_pct) if report.target_teaching_pct is not None else None,
        'teachingTargetHours': _calc_target_teaching_hours(report),
        'status': report.status.lower(),
        'confirmation': confirmation,
        'confirmationTime': _get_confirmation_time(report),
        'supervisorNote': _get_supervisor_note(report),
        'assignedBy': _get_assigned_by(report),
        'pushedAt': report.created_at.strftime('%Y-%m-%d %H:%M') if report.created_at else '',
        'cancelled': report.status == 'REJECTED',
        'isAbnormal': anomaly_result['is_anomaly'],
        'anomalyReasons': anomaly_result['reasons'],
    }


def _serialize_breakdown(report_items):
    grouped = {
        'Teaching': [],
        'Assigned Roles': [],
        'HDR': [],
        'Service': [],
    }

    for item in report_items:
        label = CATEGORY_LABELS.get(item.category)
        if not label:
            continue
        grouped[label].append({
            'name': item.unit_code or item.description or item.category,
            'hours': _to_decimal_hours(item.allocated_hours),
        })

    return grouped


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def academic_workloads(request):
    """GET /api/academic/workloads/"""
    qs = get_workload_queryset(request.staff).prefetch_related('items').order_by('-created_at')

    status_filter = (request.GET.get('status') or 'all').lower()
    if status_filter != 'all':
        qs = qs.filter(status=status_filter.upper())

    year = request.GET.get('year')
    if year:
        qs = qs.filter(academic_year=year)

    semester = request.GET.get('semester')
    if semester:
        qs = qs.filter(semester=semester)

    confirmation_filter = (request.GET.get('confirmation') or '').lower()

    reports = list(qs)
    conflict_keys = _build_department_conflict_keys(reports)

    report_ids = [str(r.report_id) for r in reports]
    confirmation_map = _get_confirmation_map(report_ids)

    items = []
    for report in reports:
        report_items = list(report.items.all())
        report_key = (report.staff_id, report.academic_year, report.semester)
        anomaly_result = evaluate_mvp_anomaly(
            report,
            department_conflict=report_key in conflict_keys,
        )
        confirmation = confirmation_map.get(str(report.report_id), 'unconfirmed')
        if confirmation_filter and confirmation_filter != confirmation:
            continue
        items.append(_serialize_workload_row(report, confirmation, anomaly_result, report_items))

    try:
        page = max(1, int(request.GET.get('page', 1)))
        page_size = max(1, min(100, int(request.GET.get('page_size', 10))))
    except (ValueError, TypeError):
        return Response(
            {'detail': 'page and page_size must be positive integers'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    paginator = Paginator(items, page_size)
    current_page = paginator.get_page(page)

    return Response({
        'items': list(current_page.object_list),
        'pagination': {
            'page': current_page.number,
            'pageSize': page_size,
            'totalItems': paginator.count,
            'totalPages': paginator.num_pages,
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def academic_workload_detail(request, id):
    """GET /api/academic/workloads/{id}/"""
    qs = get_workload_queryset(request.staff).prefetch_related('items')
    report = get_object_or_404(qs, report_id=id)

    report_items = list(report.items.all())
    anomaly_result = evaluate_mvp_anomaly(report, department_conflict=_is_department_conflict(report))
    confirmation = _get_report_confirmation(report)
    total_hours = sum((i.allocated_hours for i in report_items), Decimal('0.00'))
    staff_user = report.staff.user

    return Response({
        'id': str(report.report_id),
        'name': staff_user.get_full_name().strip() or staff_user.username,
        'employeeId': report.staff.staff_number,
        'title': '',
        'notes': _get_supervisor_note(report),
        'hours': _to_decimal_hours(total_hours),
        'targetTeachingRatio': float(report.target_teaching_pct) if report.target_teaching_pct is not None else None,
        'teachingTargetHours': _calc_target_teaching_hours(report),
        'actualTeachingRatio': _calc_actual_teaching_ratio(report_items),
        'status': report.status.lower(),
        'confirmation': confirmation,
        'confirmationTime': _get_confirmation_time(report),
        'supervisorNote': _get_supervisor_note(report),
        'assignedBy': _get_assigned_by(report),
        'pushedAt': report.created_at.strftime('%Y-%m-%d %H:%M') if report.created_at else '',
        'cancelled': report.status == 'REJECTED',
        'validation': {
            'isAbnormal': anomaly_result['is_anomaly'],
            'reason': ', '.join(anomaly_result['reasons']),
        },
        'breakdown': _serialize_breakdown(report_items),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
@transaction.atomic
def academic_confirm_workload(request, id):
    """POST /api/academic/workloads/{id}/confirm/  — no request body required."""
    report = get_object_or_404(get_workload_queryset(request.staff), report_id=id)
    anomaly_result = persist_report_anomaly(report, department_conflict=_is_department_conflict(report))
    if anomaly_result['is_anomaly']:
        return Response(
            {
                'detail': 'Cannot confirm workload with anomaly',
                'anomaly': anomaly_result['reasons'],
            },
            status=status.HTTP_409_CONFLICT,
        )

    already_confirmed = AuditLog.objects.filter(
        report=report,
        changes__kind='CONFIRMATION',
        changes__confirmation='confirmed',
    ).exists()

    if not already_confirmed:
        AuditLog.objects.create(
            report=report,
            action_by=request.staff,
            action_type='COMMENT',
            comment='Academic confirmed workload.',
            changes={'kind': 'CONFIRMATION', 'confirmation': 'confirmed'},
        )

    return Response({
        'id': str(report.report_id),
        'confirmation': 'confirmed',
        'confirmationTime': _get_confirmation_time(report),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
@transaction.atomic
def academic_submit_workload_requests(request):
    """POST /api/academic/workload-requests/"""
    # v3 contract uses camelCase keys
    workload_ids = request.data.get('workloadIds') or []
    reason = (request.data.get('reason') or '').strip()

    if not isinstance(workload_ids, list) or not workload_ids:
        return Response(
            {'detail': 'workloadIds must be a non-empty list'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(workload_ids) > 10:
        return Response(
            {'detail': 'Cannot submit more than 10 workloads at once'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not reason:
        return Response(
            {'detail': 'reason is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(reason) > 240:
        return Response(
            {'detail': 'reason must be <= 240 characters'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    scoped = get_workload_queryset(request.staff)
    reports = list(scoped.filter(report_id__in=workload_ids))
    if len(reports) != len(workload_ids):
        return Response(
            {'detail': 'One or more workloadIds are invalid or not accessible'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    non_submittable = [r for r in reports if r.status not in ('INITIAL', 'REJECTED')]
    if non_submittable:
        return Response(
            {
                'detail': 'One or more reports cannot be submitted (already pending or approved)',
                'workloadIds': [str(r.report_id) for r in non_submittable],
            },
            status=status.HTTP_409_CONFLICT,
        )

    # Academic must confirm before submit.
    confirmation_map = _get_confirmation_map([str(r.report_id) for r in reports])
    unconfirmed = [str(r.report_id) for r in reports if confirmation_map.get(str(r.report_id), 'unconfirmed') != 'confirmed']
    if unconfirmed:
        return Response(
            {
                'detail': 'One or more reports must be confirmed before submit',
                'workloadIds': unconfirmed,
            },
            status=status.HTTP_409_CONFLICT,
        )

    # Re-evaluate anomaly on submit to prevent bypassing the confirm endpoint.
    anomaly_map = {}
    for report in reports:
        anomaly_result = persist_report_anomaly(report, department_conflict=_is_department_conflict(report))
        if anomaly_result['is_anomaly']:
            anomaly_map[str(report.report_id)] = anomaly_result['reasons']

    if anomaly_map:
        return Response(
            {
                'detail': 'One or more reports have anomalies and cannot be submitted',
                'anomaly': anomaly_map,
            },
            status=status.HTTP_409_CONFLICT,
        )

    result_items = []
    for report in reports:
        log = AuditLog.objects.create(
            report=report,
            action_by=request.staff,
            action_type='COMMENT',
            comment=reason,
            changes={'kind': 'WORKLOAD_REQUEST', 'status': 'pending'},
        )
        report.status = 'PENDING'
        report.save(update_fields=['status', 'updated_at'])
        result_items.append({
            'workloadId': str(report.report_id),
            'requestId': str(log.log_id),
            'status': 'pending',
        })

    return Response(
        {
            'submittedCount': len(result_items),
            'items': result_items,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def academic_visualization(request):
    """GET /api/academic/visualization/"""
    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')

    qs = get_workload_queryset(request.staff).prefetch_related('items')
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter)

    SEM_ORDER = {'S1': 0, 'S2': 1, 'FULL_YEAR': 2}
    reports = list(qs.order_by('academic_year', 'semester'))

    seen = {}
    for r in reports:
        key = (r.academic_year, r.semester)
        seen[key] = True
    ordered_keys = sorted(seen.keys(), key=lambda k: (k[0], SEM_ORDER.get(k[1], 9)))

    my_hours_map = {}
    for r in reports:
        key = (r.academic_year, r.semester)
        total = sum(item.allocated_hours for item in r.items.all())
        my_hours_map[key] = my_hours_map.get(key, Decimal('0.00')) + total

    dept_id = request.staff.department_id
    dept_qs = WorkloadReport.objects.filter(
        is_current=True,
        snapshot_department_id=dept_id,
    ).prefetch_related('items')
    dept_qs = _filter_reports_by_range(dept_qs, year_from, year_to, semester_filter)

    dept_hours_map = {}
    for r in dept_qs.order_by('academic_year', 'semester'):
        key = (r.academic_year, r.semester)
        total = sum(item.allocated_hours for item in r.items.all())
        dept_hours_map.setdefault(key, []).append(total)

    my_vs_dept = []
    total_trend = []
    for key in ordered_keys:
        label = _build_semester_label(*key)
        my_h = float(round(my_hours_map.get(key, Decimal('0.00')), 2))
        dept_list = dept_hours_map.get(key, [])
        dept_avg = float(round(sum(dept_list) / len(dept_list), 2)) if dept_list else 0.0
        dept_total = float(round(sum(dept_list), 2))

        my_vs_dept.append({
            'semester': label,
            'myHours': my_h,
            'departmentAverage': dept_avg,
        })
        total_trend.append({
            'semester': label,
            'totalHours': dept_total,
        })

    return Response({
        'reportingPeriodLabel': _reporting_period_label(year_from, year_to, semester_filter),
        'totalHoursTrend': total_trend,
        'myVsDepartmentTrend': my_vs_dept,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def academic_export(request):
    """GET /api/academic/export/"""
    try:
        import openpyxl
    except ImportError:
        return Response(
            {'detail': 'Export unavailable: openpyxl not installed'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')

    qs = get_workload_queryset(request.staff).prefetch_related('items').order_by('academic_year', 'semester')
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter)
    # Only export approved records; pending/rejected excluded to avoid exporting unconfirmed data.
    qs = qs.filter(status='APPROVED')

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Workload Export'

    headers = [
        'Staff Number', 'Name', 'Academic Year', 'Semester',
        'Category', 'Unit Code', 'Description', 'Hours',
        'Status', 'Confirmation', 'Export Date',
    ]
    ws.append(headers)

    export_date = date.today().isoformat()

    for report in qs:
        staff_user = report.staff.user
        name = staff_user.get_full_name().strip() or staff_user.username
        confirmation = _get_report_confirmation(report)

        items = list(report.items.all())
        if not items:
            ws.append([
                report.staff.staff_number, name,
                report.academic_year, report.semester,
                '', '', '', 0,
                report.status.lower(), confirmation, export_date,
            ])
        else:
            for item in items:
                ws.append([
                    report.staff.staff_number, name,
                    report.academic_year, report.semester,
                    item.category, item.unit_code or '', item.description or '',
                    float(item.allocated_hours),
                    report.status.lower(), confirmation, export_date,
                ])

    file_name = f"Academic_Workload_{export_date}.xlsx"
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="{file_name}"'
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def academic_contact_school_ops(request):
    """POST /api/academic/contact-school-of-operations/"""
    message_body = (request.data.get('messageBody') or '').strip()
    sender = request.data.get('sender') or {}

    if not message_body:
        return Response(
            {'detail': 'messageBody is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Log the contact request as an audit entry (no report FK — system-level action).
    # A future integration can hook into this log to send an actual email/notification.
    AuditLog.objects.create(
        report=None,
        action_by=request.staff,
        action_type='COMMENT',
        comment=message_body,
        changes={
            'kind': 'CONTACT_SCHOOL_OPS',
            'sender': sender,
        },
    )

    reference_id = f"msg_{uuid.uuid4().hex[:8]}"
    return Response(
        {'ok': True, 'referenceId': reference_id},
        status=status.HTTP_201_CREATED,
    )


# ─── Legacy endpoints (kept for backward compatibility) ──────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def get_my_workloads(request):
    """GET /api/workloads/my/  — legacy response shape."""
    qs = get_workload_queryset(request.staff).order_by('-created_at')
    data = [
        {
            'report_id': str(r.report_id),
            'academic_year': r.academic_year,
            'semester': r.semester,
            'status': r.status,
            'is_anomaly': r.is_anomaly,
            'snapshot_fte': str(r.snapshot_fte),
            'created_at': r.created_at.strftime('%Y-%m-%d %H:%M'),
        }
        for r in qs
    ]
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
@transaction.atomic
def submit_query(request):
    """POST /api/queries/  — legacy query submission."""
    report_id = request.data.get('workload_report_id')
    comment = (request.data.get('comment') or '').strip()

    if not report_id or not comment:
        return Response(
            {'code': 'VALIDATION_ERROR', 'message': 'workload_report_id and comment are required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    qs = get_workload_queryset(request.staff)
    report = get_object_or_404(qs, report_id=report_id)

    already_queried = AuditLog.objects.filter(
        report=report,
        action_type='COMMENT',
        changes__kind='QUERY',
    ).exists()
    if already_queried:
        return Response(
            {'code': 'CONFLICT', 'message': 'A query has already been submitted for this report.'},
            status=status.HTTP_409_CONFLICT,
        )

    AuditLog.objects.create(
        report=report,
        action_by=request.staff,
        action_type='COMMENT',
        comment=comment,
        changes={'kind': 'QUERY'},
    )

    return Response(
        {'report_id': str(report.report_id), 'status': report.status},
        status=status.HTTP_201_CREATED,
    )
