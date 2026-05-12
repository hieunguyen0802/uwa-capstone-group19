"""
HoD API (v3) — frontend contract `IntegrationLog/hod-hos-frontend-api.zh-en(1).md` §5.

Scope: workload approval plus P1/P2 reports, analytics/export, and self-submit.

Reuses `get_workload_queryset(staff)` so HoD-only department scoping is enforced
by a single source of truth. Legacy `/api/supervisor/*` endpoints remain intact
during cutover.
"""

import io
from decimal import Decimal

from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status as http_status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.models import AuditLog, WorkloadItem, WorkloadReport
from api.permissions import IsHoD
from api.services.workload_service import (
    WORKLOAD_REQUEST_KINDS,
    _filter_reports_by_range,
    _parse_year_range,
    _reporting_period_label,
    evaluate_mvp_anomaly,
    get_workload_queryset,
    report_research_hours,
    report_total_hours,
    semester_sort_key,
    stale_report_response_payload,
    workload_item_hours_for_totals,
)


CATEGORY_LABELS = {
    'TEACHING': 'Teaching',
    'ASSIGNED_ROLE': 'Assigned Roles',
    'HDR_SUPERVISION': 'HDR',
    'SERVICE': 'Service',
}
LABEL_TO_CATEGORY = {v: k for k, v in CATEGORY_LABELS.items()}
READONLY_BREAKDOWN_LABELS = {'Research (residual)'}


def _to_hours(value: Decimal) -> float:
    return float((value or Decimal('0.00')).quantize(Decimal('0.01')))


def _first(request_data, *keys, default=''):
    """Accept both camelCase and snake_case input during alignment window."""
    for k in keys:
        if k in request_data and request_data[k] not in (None, ''):
            return request_data[k]
    return default


def _get_workload_request_meta(report):
    log = (
        AuditLog.objects.filter(report=report, changes__kind__in=WORKLOAD_REQUEST_KINDS)
        .order_by('-created_at')
        .first()
    )
    return {
        'reason': log.comment if log else '',
        'submittedAt': log.created_at.isoformat() if log else None,
    }


def _get_workload_request_meta_map(reports):
    report_ids = [report.report_id for report in reports]
    meta = {
        str(report.report_id): {'reason': '', 'submittedAt': None}
        for report in reports
    }
    if not report_ids:
        return meta

    logs = (
        AuditLog.objects.filter(report_id__in=report_ids, changes__kind__in=WORKLOAD_REQUEST_KINDS)
        .order_by('-created_at')
    )
    for log in logs:
        key = str(log.report_id)
        if key in meta and not meta[key]['submittedAt']:
            meta[key] = {
                'reason': log.comment or '',
                'submittedAt': log.created_at.isoformat() if log.created_at else None,
            }
    return meta


def _get_request_reason(report):
    return _get_workload_request_meta(report)['reason']


def _get_submitted_at(report):
    return _get_workload_request_meta(report)['submittedAt']


def _get_reviewer_note(report):
    log = (
        AuditLog.objects.filter(report=report, action_type__in=['APPROVE', 'REJECT'])
        .exclude(comment__isnull=True)
        .exclude(comment='')
        .order_by('-created_at')
        .first()
    )
    return log.comment if log else ''


def _report_item_hours(items) -> Decimal:
    return sum((workload_item_hours_for_totals(item) for item in items), Decimal('0.00'))


def _report_research_hours(report) -> Decimal:
    return report_research_hours(report)


def _serialize_breakdown(items, report=None):
    grouped = {'Teaching': [], 'Assigned Roles': [], 'HDR': [], 'Service': [], 'Research (residual)': []}
    for item in items:
        label = CATEGORY_LABELS.get(item.category)
        if label:
            grouped[label].append({
                'name': item.unit_code or item.description or item.category,
                'hours': _to_hours(item.allocated_hours),
            })
    if report is not None:
        research_hours = evaluate_mvp_anomaly(report)['metrics']['research_pts'] * Decimal('17.25')
        if research_hours > 0:
            grouped['Research (residual)'].append({
                'name': 'Research (residual)',
                'hours': _to_hours(research_hours),
            })
    return grouped


def _parse_breakdown(data):
    """Frontend-shaped breakdown dict → list[dict] for WorkloadItem create."""
    errors, parsed = [], []
    if not isinstance(data, dict):
        return parsed, ['breakdown must be an object']
    for label, rows in data.items():
        if label in READONLY_BREAKDOWN_LABELS:
            if not isinstance(rows, list):
                errors.append(f'{label} must be a list')
            continue
        category = LABEL_TO_CATEGORY.get(label)
        if not category:
            errors.append(f'{label} is not a supported breakdown category')
            continue
        if not isinstance(rows, list):
            errors.append(f'{label} must be a list')
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
    self_submit_subq = AuditLog.objects.filter(
        report=OuterRef('pk'),
    ).filter(
        Q(changes__kind='HOD_SELF_WORKLOAD_REQUEST') |
        Q(
            changes__kind='WORKLOAD_REQUEST',
            action_by=OuterRef('staff'),
            action_by__user__groups__name='HOD',
        )
    )
    return (
        get_workload_queryset(staff)
        .filter(is_current=True)
        .annotate(is_hod_self_submission=Exists(self_submit_subq))
        .filter(
            Q(status__in=['PENDING', 'APPROVED', 'REJECTED'])
            | Q(status='INITIAL', confirmation_status='CONFIRMED')
        )
        .exclude(staff=staff, is_hod_self_submission=True)
    )


def _sem_label(semester: str) -> str:
    return f'Sem{semester[-1]}' if semester and semester.startswith('S') else semester or ''


def _period_label(year, semester) -> str:
    if semester and semester.startswith('S'):
        return f'{year}-{semester[-1]}'
    return str(year or '')


def _status_summary(qs):
    counts = {
        row['status']: row['count']
        for row in qs.values('status').annotate(count=Count('pk'))
    }
    return {
        'pending': counts.get('PENDING', 0),
        'approved': counts.get('APPROVED', 0),
        'rejected': counts.get('REJECTED', 0),
    }


def _serialize_row(report, request_meta_map=None):
    items = list(report.items.all())
    staff_user = report.staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    total = _report_total_hours(report, items=items)
    request_meta = (
        request_meta_map.get(str(report.report_id), {'reason': '', 'submittedAt': None})
        if request_meta_map is not None
        else _get_workload_request_meta(report)
    )
    return {
        'id': str(report.report_id),
        'sourceWorkloadId': str(report.report_id),
        'staffId': report.staff.staff_number,
        'name': full_name,
        'title': report.staff.title or '',
        'department': report.snapshot_department.name,
        'reason': request_meta['reason'],
        'status': report.status.lower(),
        'totalWorkHours': _to_hours(total),
        'submittedAt': request_meta['submittedAt'],
        'semesterLabel': _sem_label(report.semester),
        'periodLabel': _period_label(report.academic_year, report.semester),
        # Optimistic-lock token placeholder. Current contract uses updated_at ISO;
        # strict ifVersion enforcement can be enabled later without renaming fields.
        'version': report.updated_at.isoformat() if report.updated_at else None,
    }


def _serialize_detail(report):
    items = list(report.items.all())
    staff = report.staff
    staff_user = staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    items_hours = _report_item_hours(items)

    # Include research residual so total matches Academic/Ops views
    anomaly_result = evaluate_mvp_anomaly(report)
    research_hours = anomaly_result['metrics']['research_pts'] * Decimal('17.25')
    total_hours = items_hours + research_hours

    fte = float(report.snapshot_fte or Decimal('1.00'))
    expected_min_hours = round(856 * fte, 2)
    expected_max_hours = round(864 * fte, 2)

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

    employment_type = 'Part-time' if report.snapshot_fte < Decimal('1.00') else 'Full-time'

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
        'expectedMinHours': expected_min_hours,
        'expectedMaxHours': expected_max_hours,
        'employmentType': employment_type,
        'isNewStaff': False,
        # hodReviewRequired / schoolOperationsNotes are not modelled yet; exposed as defaults
        # so the frontend contract stays stable. Backed by real data once models catch up.
        'hodReviewRequired': False,
        'schoolOperationsNotes': '',
        'applicationReason': _get_request_reason(report),
        'status': report.status.lower(),
        'breakdown': _serialize_breakdown(items, report),
        'canEditBreakdown': report.status == 'PENDING',
        'cancelled': False,
        'reviewerNote': _get_reviewer_note(report),
        'version': report.updated_at.isoformat() if report.updated_at else None,
    }


def _report_total_hours(report, items=None) -> Decimal:
    return report_total_hours(report, items)


def _report_period_id(prefix: str, year, semester, department='') -> str:
    safe_department = ''.join(ch.lower() if ch.isalnum() else '-' for ch in str(department)).strip('-')
    safe_department = '-'.join(part for part in safe_department.split('-') if part)
    suffix = f'-{safe_department}' if safe_department else ''
    return f'{prefix}-{year}-{semester}{suffix}'


def _parse_period_report_id(report_id: str, prefix: str):
    raw = str(report_id or '')
    expected = f'{prefix}-'
    if not raw.startswith(expected):
        return None, None
    rest = raw[len(expected):]
    parts = rest.split('-')
    if len(parts) < 2:
        return None, None
    try:
        year = int(parts[0])
    except ValueError:
        return None, None
    return year, parts[1].upper()


def _filter_period_params(qs, request):
    year = (request.GET.get('year') or '').strip()
    semester = (request.GET.get('semester') or '').strip()
    if year:
        try:
            qs = qs.filter(academic_year=int(year))
        except ValueError:
            return qs.none()
    if semester:
        qs = qs.filter(semester=semester.upper())
    return qs


def _semester_report_rows(qs):
    rows = {}
    for report in qs:
        key = (report.academic_year, report.semester, report.snapshot_department.name)
        current = rows.get(key)
        if current is None or report.updated_at > current:
            rows[key] = report.updated_at
    return rows


def _append_report_export_rows(ws, reports):
    for report in reports:
        user = report.staff.user
        full_name = user.get_full_name().strip() or user.username
        ws.append([
            report.staff.staff_number,
            full_name,
            report.snapshot_department.name,
            report.staff.title or '',
            _period_label(report.academic_year, report.semester),
            report.status.lower(),
            _to_hours(_report_total_hours(report)),
            _get_submitted_at(report),
            _get_request_reason(report),
            _get_reviewer_note(report),
        ])


def _workbook_response(title, filename, reports):
    try:
        import openpyxl
    except ImportError:
        return Response(
            {'success': False, 'message': 'Export unavailable: openpyxl not installed'},
            status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = title[:31]
    ws.append([
        'Staff ID',
        'Name',
        'Department',
        'Title',
        'Semester',
        'Status',
        'Total Work Hours',
        'Submitted Time',
        'Application Reason',
        'HoD Review Note',
    ])
    _append_report_export_rows(ws, reports)

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    response = HttpResponse(
        buffer.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def _analytics_payload(qs, year_from, year_to, semester_filter, scope_label):
    reports = list(qs)
    total_hours = sum((_report_total_hours(report) for report in reports), Decimal('0.00'))
    academics = {report.staff_id for report in reports}
    summary = {
        'totalAcademics': len(academics),
        'totalWorkHours': _to_hours(total_hours),
        'pendingRequests': sum(1 for r in reports if r.status == 'PENDING'),
        'approvedRequests': sum(1 for r in reports if r.status == 'APPROVED'),
        'rejectedRequests': sum(1 for r in reports if r.status == 'REJECTED'),
    }

    trend = {}
    status_distribution = {'pending': 0, 'approved': 0, 'rejected': 0, 'initial': 0}
    hours_distribution = {}
    department_stats = {}
    department_trend = {}
    for report in reports:
        label = _period_label(report.academic_year, report.semester)
        semester_label = f"{report.academic_year} {report.semester}"
        dept_name = report.snapshot_department.name
        total = _report_total_hours(report)
        bucket = trend.setdefault(label, {'period': label, 'totalWorkHours': Decimal('0.00'), 'staff': set()})
        bucket['totalWorkHours'] += total
        bucket['staff'].add(report.staff_id)
        status_distribution[report.status.lower()] = status_distribution.get(report.status.lower(), 0) + 1
        hours_distribution[dept_name] = hours_distribution.get(dept_name, Decimal('0.00')) + total

        dept_bucket = department_stats.setdefault(dept_name, {
            'department': dept_name,
            'academics': set(),
            'totalHours': Decimal('0.00'),
            'pending': 0,
            'approved': 0,
            'rejected': 0,
        })
        dept_bucket['academics'].add(report.staff_id)
        dept_bucket['totalHours'] += total
        status_key = report.status.lower()
        if status_key == 'pending':
            dept_bucket['pending'] += 1
        elif status_key == 'approved':
            dept_bucket['approved'] += 1
        elif status_key == 'rejected':
            dept_bucket['rejected'] += 1

        trend_row = department_trend.setdefault(semester_label, {'semester': semester_label})
        trend_row[dept_name] = _to_hours(Decimal(str(trend_row.get(dept_name, 0))) + total)

    total_work_hours_trend = []
    average_work_hours_by_semester = []
    for label in sorted(trend, key=semester_sort_key):
        row = trend[label]
        hours = _to_hours(row['totalWorkHours'])
        staff_count = len(row['staff'])
        total_work_hours_trend.append({'period': label, 'totalWorkHours': hours})
        average_work_hours_by_semester.append({
            'period': label,
            'averageWorkHours': round(hours / staff_count, 2) if staff_count else 0,
        })

    return {
        'reportingPeriodLabel': _reporting_period_label(year_from, year_to, semester_filter),
        'scopeLabel': scope_label,
        'summary': summary,
        'totalWorkHoursTrend': total_work_hours_trend,
        'averageWorkHoursBySemester': average_work_hours_by_semester,
        'statusDistribution': status_distribution,
        'departmentStats': [
            {
                'department': dept,
                'academics': len(row['academics']),
                'totalHours': _to_hours(row['totalHours']),
                'pending': row['pending'],
                'approved': row['approved'],
                'rejected': row['rejected'],
            }
            for dept, row in sorted(department_stats.items())
        ],
        'departmentWorkloadTrend': [
            department_trend[key]
            for key in sorted(department_trend.keys(), key=semester_sort_key)
        ],
        'workloadHoursDistribution': [
            {'department': dept, 'totalWorkHours': _to_hours(hours)}
            for dept, hours in sorted(hours_distribution.items())
        ],
    }


# ─── GET /api/hod/workload-requests/ ────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoD])
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

    paginator = Paginator(qs, page_size)
    current = paginator.get_page(page)
    page_reports = list(current.object_list)
    request_meta_map = _get_workload_request_meta_map(page_reports)
    rows = [_serialize_row(r, request_meta_map=request_meta_map) for r in page_reports]

    return Response({
        'items': rows,
        'page': current.number,
        'pageSize': page_size,
        'total': paginator.count,
        'summary': _status_summary(base_qs),
    })


# ─── GET /api/hod/workload-requests/{id}/ ───────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoD])
def hod_workload_request_detail(request, id):
    qs = _hod_visible_qs(request.staff).prefetch_related('items').select_related(
        'staff__user', 'snapshot_department'
    )
    report = get_object_or_404(qs, report_id=id)
    return Response(_serialize_detail(report))


# ─── POST /api/hod/workload-requests/{id}/decision/ ─────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated, IsHoD])
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


# ─── GET /api/hod/reports/semester ─────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoD])
def hod_semester_reports(request):
    qs = _filter_period_params(
        _hod_visible_qs(request.staff)
        .select_related('snapshot_department')
        .prefetch_related('items'),
        request,
    )
    items = []
    for (year, semester, department), updated_at in sorted(_semester_report_rows(qs).items()):
        report_id = _report_period_id('hod-report', year, semester, department)
        items.append({
            'id': report_id,
            'year': year,
            'semester': semester,
            'department': department,
            'title': f'{year} {semester} {department} report generated',
            'createdAt': updated_at.isoformat() if updated_at else None,
            'downloadUrl': f'/api/hod/reports/semester/{report_id}/download',
            'unread': True,
        })
    return Response({'items': items})


# ─── GET /api/hod/reports/semester/{reportId}/download ─────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoD])
def hod_semester_report_download(request, report_id):
    year, semester = _parse_period_report_id(report_id, 'hod-report')
    if year is None or semester is None:
        return Response(
            {'success': False, 'message': 'Invalid report id'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    reports = list(
        _hod_visible_qs(request.staff)
        .filter(academic_year=year, semester=semester)
        .select_related('staff__user', 'snapshot_department')
        .prefetch_related('items')
        .order_by('staff__staff_number')
    )
    filename = f'HoD_{year}_{semester}_{request.staff.department.name}.xlsx'.replace(' ', '_')
    return _workbook_response('HoD Semester Report', filename, reports)


# ─── GET /api/hod/analytics/workloads ──────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoD])
def hod_workload_analytics(request):
    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')
    qs = (
        _hod_visible_qs(request.staff)
        .select_related('staff__user', 'snapshot_department')
        .prefetch_related('items')
    )
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter).order_by('academic_year', 'semester')
    return Response({
        'success': True,
        'message': 'HoD analytics loaded',
        'data': _analytics_payload(qs, year_from, year_to, semester_filter, request.staff.department.name),
    })


# ─── GET /api/hod/exports/workloads ────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoD])
def hod_workload_export(request):
    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')
    qs = (
        _hod_visible_qs(request.staff)
        .select_related('staff__user', 'snapshot_department')
        .prefetch_related('items')
        .order_by('staff__staff_number', 'academic_year', 'semester')
    )
    reports = list(_filter_reports_by_range(qs, year_from, year_to, semester_filter))
    return _workbook_response('HoD Workloads', 'HoD_Workloads.xlsx', reports)


# ─── POST /api/hod/self-workload-requests ──────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated, IsHoD])
@transaction.atomic
def hod_self_workload_requests(request):
    data = request.data or {}
    workload_ids = data.get('workloadIds') or data.get('workload_ids')
    if workload_ids is None:
        single = data.get('sourceWorkloadId') or data.get('source_workload_id') or data.get('workloadId')
        workload_ids = [single] if single else []
    reason = str(
        data.get('applicationReason')
        or data.get('reason')
        or data.get('requestReason')
        or ''
    ).strip()

    if not isinstance(workload_ids, list) or not workload_ids:
        return Response(
            {'success': False, 'message': 'workloadIds or sourceWorkloadId is required'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    if not reason:
        return Response(
            {'success': False, 'message': 'applicationReason is required'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    if len(reason) > 240:
        return Response(
            {'success': False, 'message': 'applicationReason must be <= 240 characters'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    reports = list(
        WorkloadReport.objects.filter(
            report_id__in=workload_ids,
            staff=request.staff,
            is_current=True,
        )
    )
    if len(reports) != len(workload_ids):
        return Response(
            {'success': False, 'message': 'One or more workload ids are invalid or not owned by the HoD'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    blocked = [r for r in reports if r.status not in ('INITIAL', 'REJECTED')]
    if blocked:
        return Response(
            {
                'success': False,
                'message': 'One or more reports cannot be submitted',
                'workloadIds': [str(r.report_id) for r in blocked],
            },
            status=http_status.HTTP_409_CONFLICT,
        )

    items = []
    for report in reports:
        AuditLog.objects.create(
            report=report,
            action_by=request.staff,
            action_type='SUBMIT_REQUEST',
            comment=reason,
            changes={'kind': 'HOD_SELF_WORKLOAD_REQUEST', 'status': 'pending'},
        )
        report.status = 'PENDING'
        report.save(update_fields=['status', 'updated_at'])
        items.append({
            'workloadId': str(report.report_id),
            'status': 'pending',
            'targetReviewer': 'HOS',
        })

    return Response({'submittedCount': len(items), 'items': items}, status=http_status.HTTP_201_CREATED)
