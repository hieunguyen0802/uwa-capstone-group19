import io
from datetime import date
from decimal import Decimal

from django.core.paginator import Paginator
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.models import AuditLog, WorkloadReport
from api.permissions import IsAcademicOrHoD
from api.services.workload_service import (
    evaluate_mvp_anomaly,
    workload_item_hours_for_totals,
    _parse_year_range,
    _filter_reports_by_range,
    _build_semester_label,
    _reporting_period_label,
)
from api.view.supervisor_views import _get_request_reason
from api.view.ops_admin_views import _serialize_workload_detail as _serialize_ops_workload_detail


def _own_reports_qs(staff):
    # Academic pages always show only the requesting staff member's own reports,
    # even when a HOD is acting in their Academic identity.
    return WorkloadReport.objects.filter(
        is_current=True,
        staff=staff,
        distributed_at__isnull=False,
    ).select_related('staff__user', 'staff__department', 'snapshot_department')

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
    return {
        str(report.report_id): report.confirmation_status.lower()
        for report in WorkloadReport.objects.filter(report_id__in=report_ids).only('report_id', 'confirmation_status')
    }


def _get_report_confirmation(report):
    return (report.confirmation_status or 'UNCONFIRMED').lower()


def _get_confirmation_time(report):
    if not report.confirmation_at:
        return None
    return report.confirmation_at.strftime('%Y-%m-%d %H:%M')


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


def _normalized_band(value):
    return str(value or '').strip().lower()


def _has_target_band_mismatch(target_band, calculated_band):
    return bool(target_band and calculated_band and _normalized_band(target_band) != _normalized_band(calculated_band))


def _hod_review_required(report, calculated_band=None):
    if str(report.hod_review or '').strip().lower() == 'yes':
        return True
    return _has_target_band_mismatch(report.target_band, calculated_band)


def _get_assigned_by(report):
    """Return the School Ops staff member who distributed this report."""
    if report.assigned_by_id:
        return report.assigned_by.user.get_full_name().strip() or report.assigned_by.user.username

    log = AuditLog.objects.filter(
        report=report,
        action_type__in=['DISTRIBUTED', 'IMPORTED', 'MODIFIED_BY_REIMPORT'],
    ).select_related('action_by__user').order_by('-created_at').first()
    if not log or not log.action_by:
        return ''
    return log.action_by.user.get_full_name().strip() or log.action_by.user.username


def _get_pushed_at(report) -> str:
    """Return local-timezone formatted distribution timestamp; falls back to created_at."""
    if report.distributed_at:
        return timezone.localtime(report.distributed_at).strftime('%Y-%m-%d %H:%M')
    # Fallback for records distributed before the distributed_at field existed
    log = AuditLog.objects.filter(
        report=report,
        action_type__in=['DISTRIBUTE', 'DISTRIBUTED', 'APPROVE', 'APPROVED'],
    ).order_by('-created_at').first()
    dt = log.created_at if log else report.created_at
    if not dt:
        return ''
    return timezone.localtime(dt).strftime('%Y-%m-%d %H:%M')


def _calc_target_teaching_hours(report) -> float:
    """Derive target teaching hours from target_teaching_pct × FTE × 1725 hrs/year."""
    if report.target_teaching_pct is None or report.snapshot_fte is None:
        return 0.0
    annual_hrs = float(report.snapshot_fte) * 100 * 17.25
    return round(annual_hrs * float(report.target_teaching_pct) / 100, 2)



def _serialize_workload_row(report, confirmation, anomaly_result=None, report_items=None):
    """Serialize a WorkloadReport to the v3 list-item shape."""
    staff_user = report.staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    items = report_items if report_items is not None else list(report.items.all())
    items_hours = sum((workload_item_hours_for_totals(item) for item in items), Decimal('0.00'))

    if anomaly_result is None:
        anomaly_result = evaluate_mvp_anomaly(report)

    # Include research residual so total matches the 5-tab breakdown in School Ops
    research_hrs = round(float(anomaly_result['metrics']['research_pts']) * 17.25, 2)
    total_hours = round(_to_decimal_hours(items_hours) + research_hrs, 2)
    calculated_band = anomaly_result['metrics'].get('calculated_band')

    return {
        'id': str(report.report_id),
        'name': full_name,
        'employeeId': report.staff.staff_number,
        'department': report.snapshot_department.name if report.snapshot_department_id else None,
        'title': report.staff.title or '',
        'notes': _get_request_reason(report),
        'hours': total_hours,
        'academicYear': report.academic_year,
        'semester': report.semester,
        'targetTeachingRatio': float(report.target_teaching_pct) if report.target_teaching_pct is not None else None,
        'teachingTargetHours': _calc_target_teaching_hours(report),
        'status': report.status.lower(),
        'confirmation': confirmation,
        'confirmationTime': _get_confirmation_time(report),
        'supervisorNote': _get_supervisor_note(report),
        'hodReviewRequired': _hod_review_required(report, calculated_band),
        'assignedBy': _get_assigned_by(report),
        'pushedAt': _get_pushed_at(report),
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
@permission_classes([IsAuthenticated, IsAcademicOrHoD])
def academic_workloads(request):
    """GET /api/academic/workloads/"""
    qs = _own_reports_qs(request.staff).prefetch_related('items').order_by('-created_at')

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
@permission_classes([IsAuthenticated, IsAcademicOrHoD])
def academic_workload_detail(request, id):
    """GET /api/academic/workloads/{id}/"""
    qs = _own_reports_qs(request.staff).prefetch_related('items')
    report = get_object_or_404(qs, report_id=id)

    report_items = list(report.items.all())
    confirmation = _get_report_confirmation(report)
    ops_detail = _serialize_ops_workload_detail(report, report_items)
    validation = ops_detail.get('validation') or {}
    hod_review_required = str(ops_detail.get('hodReview') or '').strip().lower() == 'yes'

    return Response({
        'id': str(report.report_id),
        'name': ops_detail.get('name', ''),
        'employeeId': report.staff.staff_number,
        'studentId': report.staff.staff_number,
        'department': ops_detail.get('department'),
        'title': '',
        'notes': _get_request_reason(report),
        'hours': ops_detail.get('hours'),
        'academicYear': report.academic_year,
        'semester': report.semester,
        'targetTeachingRatio': ops_detail.get('targetTeachingRatio'),
        'teachingTargetHours': _calc_target_teaching_hours(report),
        'actualTeachingRatio': ops_detail.get('actualTeachingRatio'),
        'targetBand': ops_detail.get('targetBand'),
        'calculatedBand': ops_detail.get('calculatedBand'),
        'employmentType': 'Part-time' if float(report.snapshot_fte or 0) < 1.0 else 'Full-time',
        'isNewStaff': bool(ops_detail.get('workloadNewStaff')),
        'hodReviewRequired': hod_review_required,
        'hodReview': ops_detail.get('hodReview'),
        'status': ops_detail.get('status'),
        'confirmation': confirmation,
        'confirmationTime': _get_confirmation_time(report),
        'supervisorNote': _get_supervisor_note(report),
        'assignedBy': _get_assigned_by(report),
        'pushedAt': _get_pushed_at(report),
        'cancelled': report.status == 'REJECTED',
        'validation': {
            'isAbnormal': bool(validation.get('failedReasons') or validation.get('teachingRatioOutOfRange') or validation.get('bandMismatch') or validation.get('hoursOutOfRange')),
            'reason': ', '.join(validation.get('failedReasons') or []),
            'teachingRatioOutOfRange': bool(validation.get('teachingRatioOutOfRange')),
            'bandMismatch': bool(validation.get('bandMismatch')),
            'hoursOutOfRange': bool(validation.get('hoursOutOfRange')),
            'expectedMinHours': validation.get('expectedMinHours'),
            'expectedMaxHours': validation.get('expectedMaxHours'),
        },
        'breakdown': ops_detail.get('breakdown'),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsAcademicOrHoD])
@transaction.atomic
def academic_confirm_workload(request, id):
    """POST /api/academic/workloads/{id}/confirm/  — no request body required."""
    report = get_object_or_404(_own_reports_qs(request.staff), report_id=id)
    anomaly_result = evaluate_mvp_anomaly(
        report,
        department_conflict=_is_department_conflict(report),
    )
    if anomaly_result['is_anomaly']:
        return Response(
            {
                'detail': 'Cannot confirm workload with anomaly',
                'anomaly': anomaly_result['reasons'],
            },
            status=status.HTTP_409_CONFLICT,
        )

    if report.confirmation_status != 'CONFIRMED':
        report.confirmation_status = 'CONFIRMED'
        report.confirmation_at = timezone.now()
        report.save(update_fields=['confirmation_status', 'confirmation_at', 'updated_at'])
        AuditLog.objects.create(
            report=report,
            action_by=request.staff,
            action_type='CONFIRMATION',
            comment='Academic confirmed workload.',
            changes={'kind': 'CONFIRMATION', 'confirmation': 'confirmed'},
        )

    return Response({
        'id': str(report.report_id),
        'confirmation': 'confirmed',
        'confirmationTime': _get_confirmation_time(report),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsAcademicOrHoD])
@transaction.atomic
def academic_submit_workload_requests(request):
    """POST /api/academic/workload-requests/"""
    # v3 contract uses camelCase keys. Accept cai's single-item
    # sourceWorkloadId/applicationReason shape and the existing batch shape.
    workload_ids = request.data.get('workloadIds') or request.data.get('workload_ids')
    if workload_ids is None:
        source_workload_id = (
            request.data.get('sourceWorkloadId')
            or request.data.get('source_workload_id')
            or request.data.get('workloadId')
        )
        workload_ids = [source_workload_id] if source_workload_id else []
    reason = (
        request.data.get('reason')
        or request.data.get('applicationReason')
        or request.data.get('requestReason')
        or ''
    ).strip()

    if not isinstance(workload_ids, list) or not workload_ids:
        return Response(
            {'detail': 'workloadIds or sourceWorkloadId must be provided'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(workload_ids) > 10:
        return Response(
            {'detail': 'Cannot submit more than 10 workloads at once'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not reason:
        return Response(
            {'detail': 'reason or applicationReason is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(reason) > 240:
        return Response(
            {'detail': 'reason must be <= 240 characters'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    scoped = _own_reports_qs(request.staff)
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
    unconfirmed = [str(r.report_id) for r in reports if r.confirmation_status != 'CONFIRMED']
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
        anomaly_result = evaluate_mvp_anomaly(report, department_conflict=_is_department_conflict(report))
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
            changes={
                'kind': 'WORKLOAD_REQUEST',
                'status': 'pending',
                'source_workload_id': str(report.report_id),
            },
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
@permission_classes([IsAuthenticated, IsAcademicOrHoD])
def academic_visualization(request):
    """GET /api/academic/visualization/"""
    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')

    qs = _own_reports_qs(request.staff).prefetch_related('items')
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
        total = sum((workload_item_hours_for_totals(item) for item in r.items.all()), Decimal('0.00'))
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
        total = sum((workload_item_hours_for_totals(item) for item in r.items.all()), Decimal('0.00'))
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
@permission_classes([IsAuthenticated, IsAcademicOrHoD])
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

    qs = _own_reports_qs(request.staff).prefetch_related('items').order_by('academic_year', 'semester')
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
@permission_classes([IsAuthenticated, IsAcademicOrHoD])
def academic_contact_school_ops(request):
    """POST /api/academic/contact-school-of-operations/"""
    message_body = (request.data.get('messageBody') or '').strip()

    if not message_body:
        return Response(
            {'detail': 'messageBody is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Derive sender from the authenticated staff — never trust client-provided identity.
    staff = request.staff
    sender = {
        'name': staff.user.get_full_name(),
        'email': staff.user.email,
        'role': staff.role,
    }

    log = AuditLog.objects.create(
        report=None,
        action_by=staff,
        action_type='COMMENT',
        comment=message_body,
        changes={
            'kind': 'CONTACT_SCHOOL_OPS',
            'sender': sender,
        },
    )

    return Response(
        {'ok': True, 'referenceId': str(log.log_id)},
        status=status.HTTP_201_CREATED,
    )


# ─── Legacy endpoints (kept for backward compatibility) ──────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAcademicOrHoD])
def get_my_workloads(request):
    """GET /api/workloads/my/  — legacy response shape."""
    qs = _own_reports_qs(request.staff).order_by('-created_at')
    data = [
        {
            'report_id': str(r.report_id),
            'academic_year': r.academic_year,
            'semester': r.semester,
            'status': r.status,
            'snapshot_fte': str(r.snapshot_fte),
            'created_at': r.created_at.strftime('%Y-%m-%d %H:%M'),
        }
        for r in qs
    ]
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsAcademicOrHoD])
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

    qs = _own_reports_qs(request.staff)
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
