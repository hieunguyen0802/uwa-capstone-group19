import io
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


def _serialize_workload_row(report, confirmation, anomaly_result=None, report_items=None):
    staff_user = report.staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    items = report_items if report_items is not None else list(report.items.all())
    total_hours = sum((item.allocated_hours for item in items), Decimal('0.00'))
    first_desc = next((item for item in items if item.description), None)

    if anomaly_result is None:
        anomaly_result = {'is_anomaly': report.is_anomaly, 'reasons': []}

    return {
        'id': str(report.report_id),
        'employee_id': report.staff.staff_number,
        'name': full_name,
        'title': '',
        'description': first_desc.description if first_desc else '',
        'status': report.status.lower(),
        'confirmation': confirmation,
        'total_hours': _to_decimal_hours(total_hours),
        'pushed_time': report.created_at.strftime('%Y-%m-%d %H:%M') if report.created_at else '',
        'is_anomaly': anomaly_result['is_anomaly'],
        'anomaly_reasons': anomaly_result['reasons'],
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
            {'success': False, 'message': 'page and page_size must be positive integers'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    paginator = Paginator(items, page_size)
    current_page = paginator.get_page(page)

    return Response({
        'success': True,
        'message': 'Academic workloads loaded',
        'data': {
            'page': current_page.number,
            'page_size': page_size,
            'total': paginator.count,
            'items': list(current_page.object_list),
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
    row = _serialize_workload_row(report, confirmation, anomaly_result, report_items)

    return Response({
        'success': True,
        'message': 'Workload detail loaded',
        'data': {
            'id': row['id'],
            'employee_id': row['employee_id'],
            'name': row['name'],
            'status': row['status'],
            'confirmation': row['confirmation'],
            'total_hours': row['total_hours'],
            'description': row['description'],
            'supervisor_note': _get_supervisor_note(report),
            'breakdown': _serialize_breakdown(report_items),
        },
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
@transaction.atomic
def academic_confirm_workload(request, id):
    """POST /api/academic/workloads/{id}/confirm/"""
    confirmation = (request.data.get('confirmation') or '').lower()
    if confirmation != 'confirmed':
        return Response(
            {
                'success': False,
                'message': 'confirmation must be confirmed',
                'errors': {'confirmation': ['Only confirmed is supported']},
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    report = get_object_or_404(get_workload_queryset(request.staff), report_id=id)
    anomaly_result = persist_report_anomaly(report, department_conflict=_is_department_conflict(report))
    if anomaly_result['is_anomaly']:
        return Response(
            {
                'success': False,
                'message': 'Cannot confirm workload with anomaly',
                'errors': {
                    'anomaly': anomaly_result['reasons'],
                },
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
        'success': True,
        'message': 'Workload confirmed',
        'data': {
            'id': str(report.report_id),
            'confirmation': 'confirmed',
        },
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
@transaction.atomic
def academic_submit_workload_requests(request):
    """POST /api/academic/workload-requests/"""
    workload_ids = request.data.get('workload_ids') or []
    request_reason = (request.data.get('request_reason') or '').strip()

    if not isinstance(workload_ids, list) or not workload_ids:
        return Response(
            {
                'success': False,
                'message': 'Validation failed',
                'errors': {'workload_ids': ['At least one workload id is required']},
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not request_reason:
        return Response(
            {
                'success': False,
                'message': 'Validation failed',
                'errors': {'request_reason': ['Application reason is required']},
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(request_reason) > 240:
        return Response(
            {
                'success': False,
                'message': 'Validation failed',
                'errors': {'request_reason': ['Application reason must be <= 240 characters']},
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    scoped = get_workload_queryset(request.staff)
    reports = list(scoped.filter(report_id__in=workload_ids))
    if len(reports) != len(workload_ids):
        return Response(
            {
                'success': False,
                'message': 'Validation failed',
                'errors': {'workload_ids': ['One or more workload ids are invalid']},
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Only INITIAL or REJECTED reports can be submitted.
    # PENDING = already submitted and awaiting HOD decision.
    # APPROVED = terminal, no re-submission needed.
    non_submittable = [r for r in reports if r.status not in ('INITIAL', 'REJECTED')]
    if non_submittable:
        return Response(
            {
                'success': False,
                'message': 'One or more reports cannot be submitted (already pending or approved)',
                'errors': {'workload_ids': [str(r.report_id) for r in non_submittable]},
            },
            status=status.HTTP_409_CONFLICT,
        )

    created_ids = []
    for report in reports:
        log = AuditLog.objects.create(
            report=report,
            action_by=request.staff,
            action_type='COMMENT',
            comment=request_reason,
            changes={'kind': 'WORKLOAD_REQUEST', 'status': 'pending'},
        )
        report.status = 'PENDING'
        report.save(update_fields=['status', 'updated_at'])
        created_ids.append(str(log.log_id))

    return Response(
        {
            'success': True,
            'message': 'Request submitted to supervisor',
            'data': {
                'created_request_ids': created_ids,
                'status': 'pending',
            },
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def get_my_workloads(request):
    """
    GET /api/workloads/my/
    Legacy response for existing clients.
    """
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
    """
    POST /api/queries/
    Academic submits a query (dispute) on one of their workload reports.

    Body: { "workload_report_id": "<uuid>", "comment": "<string>" }
    Success: 201 { "report_id": "<uuid>", "status": "PENDING" }
    Errors:
      400 — missing fields
      404 — report not found or not owned by this academic
      409 — report already has a COMMENT log (query already submitted)
    """
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


def _build_semester_label(year: int, semester: str) -> str:
    return f"{year} {semester}"


def _parse_year_range(request):
    """Parse year_from / year_to from query params. Returns (year_from, year_to) as ints or None."""
    try:
        year_from = int(request.GET['year_from']) if request.GET.get('year_from') else None
        year_to = int(request.GET['year_to']) if request.GET.get('year_to') else None
    except (ValueError, TypeError):
        year_from = year_to = None
    return year_from, year_to


def _filter_reports_by_range(qs, year_from, year_to, semester_filter):
    if year_from:
        qs = qs.filter(academic_year__gte=year_from)
    if year_to:
        qs = qs.filter(academic_year__lte=year_to)
    if semester_filter and semester_filter.upper() != 'ALL':
        qs = qs.filter(semester=semester_filter.upper())
    return qs


def _reporting_period_label(year_from, year_to, semester_filter) -> str:
    year_part = f"{year_from or '?'}-{year_to or '?'}"
    sem_part = 'All Semesters' if not semester_filter or semester_filter.upper() == 'ALL' else semester_filter.upper()
    return f"{year_part} {sem_part}"


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def academic_visualization(request):
    """GET /api/academic/visualization/"""
    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')

    qs = get_workload_queryset(request.staff).prefetch_related('items')
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter)

    # Build ordered list of (year, semester) buckets present in the data.
    SEM_ORDER = {'S1': 0, 'S2': 1, 'FULL_YEAR': 2}
    reports = list(qs.order_by('academic_year', 'semester'))

    # Collect unique (year, semester) keys in display order.
    seen = {}
    for r in reports:
        key = (r.academic_year, r.semester)
        seen[key] = True
    ordered_keys = sorted(seen.keys(), key=lambda k: (k[0], SEM_ORDER.get(k[1], 9)))

    # Aggregate my hours per bucket.
    my_hours_map = {}
    for r in reports:
        key = (r.academic_year, r.semester)
        total = sum(item.allocated_hours for item in r.items.all())
        my_hours_map[key] = my_hours_map.get(key, Decimal('0.00')) + total

    # Aggregate department average per bucket (all staff in same department).
    dept_id = request.staff.department_id
    dept_qs = WorkloadReport.objects.filter(
        is_current=True,
        snapshot_department_id=dept_id,
    ).prefetch_related('items')
    dept_qs = _filter_reports_by_range(dept_qs, year_from, year_to, semester_filter)

    dept_hours_map = {}   # key -> list of per-staff totals
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
            'my_hours': my_h,
            'department_average': dept_avg,
        })
        total_trend.append({
            'semester': label,
            'total_hours': dept_total,
        })

    return Response({
        'success': True,
        'message': 'Visualization loaded',
        'data': {
            'reporting_period_label': _reporting_period_label(year_from, year_to, semester_filter),
            'my_vs_department_trend': my_vs_dept,
            'total_hours_trend': total_trend,
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def academic_export(request):
    """GET /api/academic/export/

    Returns an Excel file containing the current academic's workload records
    for the requested year/semester range. Only APPROVED records are included
    (in-progress records are excluded to avoid exporting unconfirmed data).
    The file name includes today's date so repeated exports are distinguishable.
    """
    try:
        import openpyxl
    except ImportError:
        return Response(
            {'success': False, 'message': 'Export unavailable: openpyxl not installed'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')

    qs = get_workload_queryset(request.staff).prefetch_related('items').order_by('academic_year', 'semester')
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter)

    # Only export records that have been approved; pending/rejected are excluded.
    # Rationale: exporting unconfirmed data could mislead downstream consumers.
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
