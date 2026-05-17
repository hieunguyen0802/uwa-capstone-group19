"""
School Operations endpoints.

Authenticated roles: SCHOOL_OPS, HOS (school-wide visibility).

Routes are registered under both /api/school-operations/* (new contract) and
/api/admin/* (legacy alias kept for backward compatibility).
Comments are English-only per project guideline.
"""

import io
import re
import uuid
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.mail import send_mail
from django.core.paginator import Paginator
from django.db import models, transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from api.models import (
    AuditLog,
    Department,
    Staff,
    StaffRoleAssignment,
    SystemConfig,
    WorkloadItem,
    WorkloadDistributionJob,
    WorkloadReport,
)
from api.permissions import CanAccessSchoolOpsApi
from api.services.workload_service import (
    get_workload_queryset,
    _filter_reports_by_range,
    _parse_year_range,
    evaluate_mvp_anomaly,
    report_total_hours,
    semester_sort_key,
    stale_report_response_payload,
    workload_item_counts_toward_total,
    workload_item_hours_for_totals,
)
from api.services.audit_service import compute_diffs, write_audit
from api.view.supervisor_views import (
    _get_request_reason,
    _get_supervisor_note,
    _parse_breakdown_data,
    _to_decimal_hours,
)

ACADEMIC_IMPORT_DEPARTMENTS = (
    'Physics',
    'Mathematics & Statistics',
    'Computer Science & Software Engineering',
)
SUPERSEDED_ROLE_REASON = 'Superseded by a newer role assignment.'
MAX_EXCEL_UPLOAD_BYTES = 5 * 1024 * 1024
EXPORT_MEDIA_SUBDIR = 'exports'
TEMPLATE_MEDIA_SUBDIR = 'templates'
OPS_CURRENT_YEAR_CONFIG_KEY = 'OPS_CURRENT_WORKLOAD_YEAR'
OPS_CURRENT_SEMESTER_CONFIG_KEY = 'OPS_CURRENT_WORKLOAD_SEMESTER'
OPS_CURRENT_YEAR_DESCRIPTION = 'Active School Ops workload cycle year shown by default in the workload management tab.'
OPS_CURRENT_SEMESTER_DESCRIPTION = 'Active School Ops workload cycle semester shown by default in the workload management tab.'


class AdminImportThrottle(UserRateThrottle):
    rate = '30/hour'


class AdminExportThrottle(UserRateThrottle):
    rate = '60/hour'


def _normalized_band(value):
    return str(value or '').strip().lower()


def _has_target_band_mismatch(target_band, calculated_band):
    return bool(target_band and calculated_band and _normalized_band(target_band) != _normalized_band(calculated_band))


def _effective_hod_review(report, calculated_band=None):
    if str(report.hod_review or '').strip().lower() == 'yes':
        return 'yes'
    if _has_target_band_mismatch(report.target_band, calculated_band):
        return 'yes'
    return 'no'


def _format_excel_count(value):
    try:
        numeric = Decimal(str(value if value is not None else 0))
    except Exception:
        numeric = Decimal('0')
    if numeric == numeric.to_integral_value():
        return str(int(numeric))
    return str(numeric.normalize())


def _ensure_media_subdir(segment: str) -> Path:
    base = Path(settings.MEDIA_ROOT) / segment
    base.mkdir(parents=True, exist_ok=True)
    return base


def _admin_reports_qs(staff):
    """
    Ops/HoS can see every current report (no Hod visibility gate).
    This matches school-wide dashboards while keeping academic/Hod isolation intact.
    """
    return get_workload_queryset(staff).filter(is_current=True)


def _parse_semester_filter(request):
    """Accept semester query from contract; tolerate missing value."""
    return (request.GET.get('semester') or 'All').strip()


def _parse_department_filter(request):
    """
    Mirrors integration doc: department=All Departments|<exact department name>.

    Loose matching is avoided to prevent substring leaks across similarly named departments.
    """
    raw = (request.GET.get('department') or '').strip()
    if not raw:
        return None
    if raw.lower() in {'all departments', 'all'}:
        return None
    return raw


def _distribution_year_bounds(year_int: int) -> bool:
    return 2000 <= year_int <= 2100


def _ops_calendar_cycle(now=None):
    """
    Return the calendar-driven School Ops cycle.

    S1: 01 Jan – 30 Jun
    S2: 01 Jul – 31 Dec
    """
    current = timezone.localtime(now or timezone.now())
    if current.month >= 7:
        return current.year, 'S2'
    return current.year, 'S1'


def _ops_cycle_rank(year_int: int, semester: str):
    semester_rank = {'S1': 1, 'S2': 2, 'FULL_YEAR': 3}.get(semester, 0)
    return year_int, semester_rank


def _ops_period_label(year_int: int | None, semester: str | None):
    if year_int is None:
        return ''
    if not semester or semester == 'ALL':
        return str(year_int)
    return f'{year_int}-{semester}'


def _set_system_config_value(config_key: str, config_value: str, value_type: str, description: str, staff=None):
    SystemConfig.objects.update_or_create(
        config_key=config_key,
        defaults={
            'config_value': str(config_value),
            'value_type': value_type,
            'description': description,
            'updated_by': staff,
        },
    )


def _persist_ops_cycle(year_int: int, semester: str, staff=None, source='manual'):
    _set_system_config_value(
        OPS_CURRENT_YEAR_CONFIG_KEY,
        str(year_int),
        'INT',
        OPS_CURRENT_YEAR_DESCRIPTION,
        staff,
    )
    _set_system_config_value(
        OPS_CURRENT_SEMESTER_CONFIG_KEY,
        semester,
        'STR',
        OPS_CURRENT_SEMESTER_DESCRIPTION,
        staff,
    )
    if staff is not None:
        AuditLog.objects.create(
            report=None,
            action_by=staff,
            action_type='CONFIG_CHANGE',
            comment=f'School Ops cycle set to {year_int}-{semester}',
            changes={
                'config_scope': 'OPS_CURRENT_CYCLE',
                'year': year_int,
                'semester': semester,
                'source': source,
            },
        )


def _ensure_ops_active_cycle(staff=None):
    calendar_year, calendar_semester = _ops_calendar_cycle()

    year_config = SystemConfig.objects.filter(config_key=OPS_CURRENT_YEAR_CONFIG_KEY).first()
    semester_config = SystemConfig.objects.filter(config_key=OPS_CURRENT_SEMESTER_CONFIG_KEY).first()

    if not year_config or not semester_config:
        _persist_ops_cycle(calendar_year, calendar_semester, staff, source='calendar-init')
        return calendar_year, calendar_semester

    try:
        stored_year = int(year_config.config_value)
    except (TypeError, ValueError):
        stored_year = calendar_year

    stored_semester = (semester_config.config_value or '').strip().upper()
    if stored_semester not in {'S1', 'S2'}:
        stored_semester = calendar_semester

    if _ops_cycle_rank(stored_year, stored_semester) < _ops_cycle_rank(calendar_year, calendar_semester):
        _persist_ops_cycle(calendar_year, calendar_semester, staff, source='calendar-rollover')
        return calendar_year, calendar_semester

    return stored_year, stored_semester


def _resolve_ops_period(request, staff):
    active_year, active_semester = _ensure_ops_active_cycle(staff)
    raw_year = (request.GET.get('year') or '').strip()
    raw_semester = (request.GET.get('semester') or '').strip().upper()

    explicit_year = None
    if raw_year:
        try:
            explicit_year = int(raw_year)
        except (TypeError, ValueError):
            explicit_year = None

    if raw_semester not in {'', 'ALL', 'S1', 'S2', 'FULL_YEAR'}:
        raw_semester = ''

    if explicit_year is None and raw_semester in {'S1', 'S2', 'FULL_YEAR'}:
        explicit_year = active_year

    effective_year = explicit_year if explicit_year is not None else active_year
    if explicit_year is None and raw_semester in {'', 'ALL'}:
        effective_semester = active_semester
    elif raw_semester in {'', 'ALL'}:
        effective_semester = None
    else:
        effective_semester = raw_semester

    return {
        'active_year': active_year,
        'active_semester': active_semester,
        'effective_year': effective_year,
        'effective_semester': effective_semester,
        'active_label': _ops_period_label(active_year, active_semester),
        'effective_label': _ops_period_label(effective_year, effective_semester),
    }


def _normalize_front_status(value: str):
    cleaned = (value or '').strip().lower()
    if cleaned in {'initial', 'pending', 'approved', 'rejected'}:
        return cleaned.upper()
    return None


def _serialize_staff_row(staff_row: Staff):
    user_obj = staff_row.user
    return {
        'id': str(staff_row.staff_id),
        'staffId': staff_row.staff_number,
        'firstName': user_obj.first_name or '',
        'lastName': user_obj.last_name or '',
        'email': user_obj.email or '',
        'title': staff_row.title or '',
        'currentDepartment': staff_row.department.name if staff_row.department_id else '',
        'isActive': staff_row.is_active,
        'isNewEmployee': False,
        'notes': '',
        'updatedAt': staff_row.updated_at.strftime('%Y-%m-%d %H:%M'),
    }


def _coerce_import_bool(value, default=None):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if not normalized:
        return default
    if normalized in {'active', 'yes', 'true', '1', 'y'}:
        return True
    if normalized in {'inactive', 'no', 'false', '0', 'n'}:
        return False
    return default


def _get_distributed_time(report):
    """Return UTC ISO string for distributed_at; frontend localises via formatLocalDateTime."""
    if not report.distributed_at:
        return ''
    return report.distributed_at.isoformat()


def _get_operated_by_actor(report):
    """
    Return the staff member responsible for the current row state.

    - Distributed rows (distributed_at set): the person who ran distribute
    - APPROVED / REJECTED rows (HoD decision): last approver/rejector
    - INITIAL rows (Pending Distribution): importer / re-importer
    """
    if report.distributed_at:
        action_types = ['DISTRIBUTED']
    elif report.status == 'INITIAL':
        action_types = ['IMPORTED', 'MODIFIED_BY_REIMPORT']
    elif report.status == 'REJECTED':
        action_types = ['REJECT', 'REJECTED']
    else:
        action_types = ['APPROVE', 'APPROVED']

    return (
        AuditLog.objects.filter(report=report, action_type__in=action_types)
        .select_related('action_by__user')
        .order_by('-created_at')
        .first()
    )


def _get_pending_assignee(report):
    """Return the School Ops assignee for INITIAL / Pending Distribution rows."""
    if report.assigned_by_id:
        return report.assigned_by
    fallback_log = (
        AuditLog.objects.filter(report=report, action_type__in=['IMPORTED', 'MODIFIED_BY_REIMPORT'])
        .select_related('action_by__user')
        .order_by('-created_at')
        .first()
    )
    return fallback_log.action_by if fallback_log else None


def _serialize_workload_row(report, items):
    """Serialize a WorkloadReport to the school-operations contract list shape."""
    staff_user = report.staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    actor_log = _get_operated_by_actor(report)
    actor = actor_log.action_by if actor_log else None
    actor_name = ''
    actor_staff_number = ''
    if actor:
        actor_name = actor.user.get_full_name().strip() or actor.user.username
        actor_staff_number = actor.staff_number
    assignee = _get_pending_assignee(report)
    assigned_name = ''
    assigned_staff_number = ''
    if assignee:
        assigned_name = assignee.user.get_full_name().strip() or assignee.user.username
        assigned_staff_number = assignee.staff_number
    items_hours = sum((workload_item_hours_for_totals(i) for i in items), Decimal('0.00'))
    first_teaching = next((i for i in items if i.category == 'TEACHING' and i.unit_code), None)
    sem = report.semester or ''
    sem_label = sem
    period_label = _ops_period_label(report.academic_year, sem)

    # Include research residual in total so list badge matches the 5-tab detail sum.
    anomaly_result = evaluate_mvp_anomaly(report)
    research_hrs = round(float(anomaly_result['metrics']['research_pts']) * 17.25, 2)
    total_hours = round(_to_decimal_hours(items_hours) + research_hrs, 2)
    calculated_band = anomaly_result['metrics'].get('calculated_band')

    return {
        'id': str(report.report_id),
        'studentId': report.staff.staff_number,
        'semesterLabel': sem_label,
        'periodLabel': period_label,
        'name': full_name,
        'unit': first_teaching.unit_code if first_teaching else '',
        'notes': _get_request_reason(report),
        'requestReason': _get_request_reason(report),
        'title': report.staff.title or '',
        'department': report.snapshot_department.name,
        'rate': int(float(report.snapshot_fte) * 100),
        'status': report.status.lower(),
        'confirmation': report.confirmation_status.lower(),
        'confirmationTime': report.confirmation_at.isoformat() if report.confirmation_at else '',
        'hours': total_hours,
        'supervisorNote': _get_supervisor_note(report),
        'operatedBy': actor_name,
        'operatedByStaffId': actor_staff_number,
        'assignedBy': assigned_name,
        'assignedByStaffId': assigned_staff_number,
        'targetTeachingRatio': float(report.target_teaching_pct) if report.target_teaching_pct is not None else None,
        'teachingTargetHours': None,
        'cancelled': False,
        'importedFromTemplate': report.import_batch_id is not None,
        'targetBand': report.target_band,
        'workloadNewStaff': report.new_staff,
        'hodReview': _effective_hod_review(report, calculated_band),
        'staffRole': report.staff.role,
        'fte': float(report.snapshot_fte),
        'distributedTime': _get_distributed_time(report),
        'createdAt': report.created_at.isoformat(),
    }


def _serialize_workload_detail(report, items):
    """Serialize a WorkloadReport to the school-operations contract detail shape."""
    staff_user = report.staff.user
    full_name = staff_user.get_full_name().strip() or staff_user.username
    total_hours = sum((workload_item_hours_for_totals(i) for i in items), Decimal('0.00'))

    anomaly_result = evaluate_mvp_anomaly(report)
    metrics = anomaly_result['metrics']
    calc_tr = float(metrics['calc_tr'])
    calculated_band = metrics['calculated_band']

    # Build breakdown grouped by category with conflict flags
    CATEGORY_LABELS = {
        'TEACHING': 'Teaching',
        'ASSIGNED_ROLE': 'Assigned Roles',
        'HDR_SUPERVISION': 'HDR',
        'SERVICE': 'Service',
    }
    breakdown = {'Teaching': [], 'HDR': [], 'Service': [], 'Assigned Roles': [], 'Research (residual)': []}
    for item in items:
        label = CATEGORY_LABELS.get(item.category)
        if label:
            breakdown[label].append({
                'name': item.unit_code or item.description or item.category,
                'hours': _to_decimal_hours(item.allocated_hours),
                'excludeFromWorkloadTotal': not workload_item_counts_toward_total(item),
            })

    research_hrs = round(float(metrics['research_pts']) * 17.25, 2)
    if research_hrs > 0:
        breakdown['Research (residual)'].append({
            'name': 'Research (residual)',
            'hours': research_hrs,
        })

    # Total = all 5 tabs (Teaching + HDR + Service + Roles + Research residual)
    total_with_research = round(_to_decimal_hours(total_hours) + research_hrs, 2)

    fte = float(report.snapshot_fte or 0)
    failed_reasons = anomaly_result['reasons']
    target_band = report.target_band

    # Backend-computed visual indicator flags (frontend only displays, never computes)
    teaching_ratio_out_of_range = calc_tr < 0 or calc_tr > 1
    band_mismatch = _has_target_band_mismatch(target_band, calculated_band)
    hours_out_of_range = (total_with_research <= 856 * fte or total_with_research > 864 * fte) if fte > 0 else False

    return {
        'id': str(report.report_id),
        'studentId': report.staff.staff_number,
        'name': full_name,
        'department': report.snapshot_department.name,
        'status': report.status.lower(),
        'hours': total_with_research,
        'targetTeachingRatio': float(report.target_teaching_pct) if report.target_teaching_pct is not None else None,
        'actualTeachingRatio': round(calc_tr * 100, 1),
        'targetBand': target_band,
        'calculatedBand': calculated_band,
        'fte': fte,
        'workloadNewStaff': report.new_staff,
        'hodReview': _effective_hod_review(report, calculated_band),
        'staffRole': report.staff.role,
        'cancelled': False,
        'notes': _get_request_reason(report),
        'validation': {
            'teachingRatioOutOfRange': teaching_ratio_out_of_range,
            'bandMismatch': band_mismatch,
            'hoursOutOfRange': hours_out_of_range,
            'expectedMinHours': round(856 * fte, 2),
            'expectedMaxHours': round(864 * fte, 2),
            'failedReasons': failed_reasons,
        },
        'breakdown': breakdown,
    }


def _serialize_assignment_row(obj: StaffRoleAssignment):    return {
        'id': obj.assignment_id,
        'staff_id': obj.staff.staff_number,
        'role': obj.role_code,
        'department': obj.department_scope,
        'permissions': obj.permissions or [],
        'status': obj.status,
    }


def _dedupe_latest_assignment_by_staff(assignments):
    latest_by_staff = {}
    for assignment in assignments:
        if assignment.staff_id in latest_by_staff:
            continue
        latest_by_staff[assignment.staff_id] = assignment
    return list(latest_by_staff.values())


def _build_visualization_payload(reports_queryset, year_from, year_to, semester_filter, dept_label_scope):
    """
    Shape aligns with frontend_api_contract_cn.md §9.11 HoS visualization for Admin reuse.

    reports_queryset must be prefetch_related('items') for performance.
    """
    departments = sorted(
        {r.snapshot_department.name for r in reports_queryset},
        key=lambda name: name.lower(),
    )

    dept_stats = {}
    for report in reports_queryset:
        dept_name = report.snapshot_department.name
        bucket = dept_stats.setdefault(dept_name, {
            'department': dept_name,
            'academics': set(),
            'total_hours': Decimal('0.00'),
            'pending': 0,
            'approved': 0,
            'rejected': 0,
        })
        bucket['academics'].add(report.staff_id)
        total_h = report_total_hours(report)
        bucket['total_hours'] += total_h
        status_key = report.status.lower()
        if status_key == 'pending':
            bucket['pending'] += 1
        elif status_key == 'approved':
            bucket['approved'] += 1
        elif status_key == 'rejected':
            bucket['rejected'] += 1

    department_stats = []
    for dept_name in departments:
        data = dept_stats[dept_name]
        department_stats.append({
            'department': dept_name,
            'academics': len(data['academics']),
            'total_hours': float(round(data['total_hours'], 2)),
            'pending': data['pending'],
            'approved': data['approved'],
            'rejected': data['rejected'],
        })

    trend_map = {}
    for report in reports_queryset:
        label = f"{report.academic_year} {report.semester}"
        entry = trend_map.setdefault(label, {'semester': label})
        dept_name = report.snapshot_department.name
        hrs = report_total_hours(report)
        entry[dept_name] = float(round(Decimal(str(entry.get(dept_name, 0))) + hrs, 2))

    workload_trend = [trend_map[key] for key in sorted(trend_map.keys(), key=semester_sort_key)]

    total_hours_all = Decimal('0.00')
    for report in reports_queryset:
        total_hours_all += report_total_hours(report)
    academics_union = set()
    pending_total = approved_total = rejected_total = 0
    for report in reports_queryset:
        academics_union.add(report.staff_id)
        st = report.status.lower()
        if st == 'pending':
            pending_total += 1
        elif st == 'approved':
            approved_total += 1
        elif st == 'rejected':
            rejected_total += 1

    reporting_period_label = f"{year_from or '?'}-{year_to or '?'}"
    semester_part = semester_filter.upper() if semester_filter else 'ALL'
    if semester_part == 'ALL':
        reporting_period_label += ' All Semesters'
    else:
        reporting_period_label += f' {semester_part}'
    scope_label = dept_label_scope or 'All Departments'

    return {
        'reportingPeriodLabel': reporting_period_label,
        'scopeLabel': scope_label,
        'summary': {
            'totalDepartments': len(departments),
            'totalAcademics': len(academics_union),
            'totalWorkHours': float(round(total_hours_all, 2)),
            'pendingRequests': pending_total,
            'approvedRequests': approved_total,
            'rejectedRequests': rejected_total,
        },
        'departmentStats': department_stats,
        'trend': workload_trend,
    }


def _staff_from_body_or_path(request, lookup_id: str):
    """Resolve staff rows using immutable staff_number identifiers from the contracts."""
    return get_object_or_404(Staff, staff_number=lookup_id.strip())


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_workload_requests(request):
    """GET /api/school-operations/workloads  (also /api/admin/workload-requests/)"""
    cycle = _resolve_ops_period(request, request.staff)
    base_qs = _admin_reports_qs(request.staff).prefetch_related('items').select_related(
        'staff__user', 'staff__department', 'snapshot_department'
    )
    base_qs = base_qs.filter(academic_year=cycle['effective_year'])
    if cycle['effective_semester']:
        base_qs = base_qs.filter(semester=cycle['effective_semester'])

    qs = base_qs

    # New contract uses status_filter; legacy used status — accept both.
    status_filter = (request.GET.get('status_filter') or request.GET.get('status') or 'all').lower()
    if status_filter == 'pending':
        qs = qs.filter(status='PENDING')
    elif status_filter == 'distributed':
        qs = qs.filter(distributed_at__isnull=False)
    elif status_filter == 'failed':
        qs = qs.filter(status='REJECTED')
    elif status_filter == 'superseded':
        # superseded = non-current; override base_qs which already filters is_current=True
        qs = get_workload_queryset(request.staff).filter(is_current=False).prefetch_related('items').select_related(
            'staff__user', 'staff__department', 'snapshot_department'
        )
    elif status_filter == 'initial':
        # Pending Distribution = INITIAL status AND not yet distributed
        qs = qs.filter(status='INITIAL', distributed_at__isnull=True)
    # 'all' → no additional filter

    # New contract query params
    staff_id = request.GET.get('staff_id', '').strip()
    if staff_id:
        qs = qs.filter(staff__staff_number=staff_id)

    name = request.GET.get('name', '').strip()
    if name:
        qs = qs.filter(
            models.Q(staff__user__first_name__icontains=name)
            | models.Q(staff__user__last_name__icontains=name)
        )

    dept_name = _parse_department_filter(request)
    if dept_name:
        qs = qs.filter(snapshot_department__name=dept_name)

    qs = qs.order_by('created_at')

    counts = {
        'pending': base_qs.filter(status='PENDING').count(),
        'distributed': base_qs.filter(distributed_at__isnull=False).count(),
        'failed': base_qs.filter(status='REJECTED').count(),
        'superseded': get_workload_queryset(request.staff).filter(is_current=False).count(),
    }

    try:
        page = max(1, int(request.GET.get('page', 1)))
        page_size = max(1, min(100, int(request.GET.get('page_size', 10))))
    except (ValueError, TypeError):
        return Response(
            {'success': False, 'message': 'page and page_size must be positive integers'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    rows = [_serialize_workload_row(r, list(r.items.all())) for r in qs]
    paginator = Paginator(rows, page_size)
    current_page = paginator.get_page(page)

    return Response({
        'success': True,
        'message': 'Workload list loaded',
        'data': {
            'items': list(current_page.object_list),
            'pagination': {
                'page': current_page.number,
                'pageSize': page_size,
                'totalItems': paginator.count,
                'totalPages': paginator.num_pages,
            },
            'counts': counts,
            'currentPeriod': {
                'year': cycle['active_year'],
                'semester': cycle['active_semester'],
                'label': cycle['active_label'],
            },
            'effectivePeriod': {
                'year': cycle['effective_year'],
                'semester': cycle['effective_semester'] or 'ALL',
                'label': cycle['effective_label'],
            },
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_workload_request_detail(request, id):
    """GET /api/school-operations/workloads/{id}  (also /api/admin/workload-requests/{id}/)"""
    qs = (
        _admin_reports_qs(request.staff)
        .prefetch_related('items')
        .select_related('staff__user', 'staff__department', 'snapshot_department')
    )
    report = get_object_or_404(qs, report_id=id)
    items = list(report.items.all())

    return Response({
        'success': True,
        'message': 'Workload detail loaded',
        'data': _serialize_workload_detail(report, items),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_workload_history(request, id):
    """GET /api/school-operations/workloads/{id}/history"""
    qs = _admin_reports_qs(request.staff)
    report = get_object_or_404(qs, report_id=id)

    logs = (
        AuditLog.objects
        .filter(report=report)
        .select_related('action_by__user')
        .order_by('created_at')
    )

    _ACTION_LABEL = {
        'IMPORTED': 'Imported',
        'MODIFIED_BY_REIMPORT': 'Re-imported',
        'APPROVE': 'Approved',
        'REJECT': 'Rejected',
        'WORKLOAD_EDIT': 'Workload edited',
        'PROFILE_EDIT': 'Profile edited',
        'SUBMIT_REQUEST': 'Submitted for approval',
        'CONFIRMATION': 'Confirmed by academic',
        'CONTACT_STAFF': 'Contacted staff',
    }

    entries = []
    for log in logs:
        actor = log.action_by
        changed_by = (
            actor.user.get_full_name().strip() or actor.user.username
            if actor and actor.user else 'System'
        )
        action_label = _ACTION_LABEL.get(log.action_type, log.action_type)
        changes = log.changes or {}
        diffs = changes.get('diffs') or []
        ts = log.created_at.strftime('%Y-%m-%d %H:%M')

        if diffs:
            for d in diffs:
                entries.append({
                    'changeId': f"{log.id}-{d.get('field', '')}",
                    'reportId': str(report.report_id),
                    'action': action_label,
                    'fieldName': d.get('field', ''),
                    'oldValue': d.get('before', ''),
                    'newValue': d.get('after', ''),
                    'changedBy': changed_by,
                    'changedAt': ts,
                    'comment': log.comment or '',
                })
        else:
            entries.append({
                'changeId': str(log.id),
                'reportId': str(report.report_id),
                'action': action_label,
                'fieldName': '',
                'oldValue': '',
                'newValue': '',
                'changedBy': changed_by,
                'changedAt': ts,
                'comment': log.comment or '',
            })

    return Response({'success': True, 'data': entries})


@api_view(['POST'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@transaction.atomic
def admin_batch_decision(request):
    """POST /api/admin/workload-requests/batch-decision/"""
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

    qs = _admin_reports_qs(request.staff)
    reports = list(qs.filter(report_id__in=request_ids))

    if len(reports) != len(request_ids):
        found_ids = {str(r.report_id) for r in reports}
        missing_ids = [rid for rid in request_ids if str(rid) not in found_ids]
        stale_ids = list(
            WorkloadReport.objects.filter(report_id__in=missing_ids, is_current=False)
            .values_list('report_id', flat=True)
        )
        if stale_ids:
            return Response(
                stale_report_response_payload({'errors': {'request_ids': [str(x) for x in stale_ids]}}),
                status=http_status.HTTP_409_CONFLICT,
            )
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


@api_view(['POST'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@transaction.atomic
def admin_single_decision(request, id):
    """POST /api/admin/workload-requests/{id}/decision/"""
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

    qs = _admin_reports_qs(request.staff)
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
        report.items.all().delete()
        WorkloadItem.objects.bulk_create([
            WorkloadItem(report=report, **kwargs) for kwargs in parsed
        ])

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


@api_view(['POST'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@transaction.atomic
def admin_distribute_workloads(request):
    """POST /api/school-operations/workloads/distribute

    Validates each workload individually and distributes (APPROVED) those that pass.
    Returns per-item success/failure so the frontend can show both tabs correctly.
    """
    # Permission is enforced by the DRF permission class above.

    workload_ids = request.data.get('workloadIds') or []
    year = request.data.get('academicYear') or request.data.get('year')
    semester = (request.data.get('semester') or '').strip().upper()

    try:
        year_int = int(year)
    except (TypeError, ValueError):
        return Response(
            {'success': False, 'message': 'academicYear must be a valid integer'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if not _distribution_year_bounds(year_int):
        return Response(
            {'success': False, 'message': 'academicYear outside allowed range (2000-2100)'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if semester not in {'S1', 'S2', 'FULL_YEAR'}:
        return Response(
            {'success': False, 'message': 'semester must be S1, S2, or FULL_YEAR'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if not isinstance(workload_ids, list) or not workload_ids:
        return Response(
            {'success': False, 'message': 'workloadIds must be a non-empty list'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if len(workload_ids) > 200:
        return Response(
            {'success': False, 'message': 'Cannot distribute more than 200 workloads at once'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    # ── Check 2: all workloads must exist and be visible to this user ──────────
    # select_for_update() prevents concurrent distribute calls from double-distributing
    # the same workload when the user clicks Confirm multiple times.
    qs = _admin_reports_qs(request.staff).select_related(
        'staff__user', 'staff__department', 'snapshot_department'
    ).prefetch_related('items').select_for_update()
    reports = list(qs.filter(report_id__in=workload_ids))

    if len(reports) != len(workload_ids):
        return Response(
            {'success': False, 'message': 'One or more workloadIds are invalid or not accessible'},
            status=http_status.HTTP_404_NOT_FOUND,
        )

    now = timezone.now()
    now_str = now.strftime('%Y-%m-%d %H:%M')
    operated_by = request.staff.user.get_full_name().strip() or request.staff.user.username

    succeeded = []
    failed = []

    for report in reports:
        try:
            if report.academic_year != year_int or report.semester != semester:
                failed.append({
                    'workloadId': str(report.report_id),
                    'staffId': report.staff.staff_number,
                    'name': report.staff.user.get_full_name(),
                    'error': (
                        f'Workload period is {report.academic_year}-{report.semester}, '
                        f'but the selected cycle is {year_int}-{semester}'
                    ),
                    'errorCode': 'PERIOD_MISMATCH',
                })
                continue

            # ── Check 3: must be Pending Distribution (INITIAL, not yet distributed) ─
            if report.status != 'INITIAL':
                failed.append({
                    'workloadId': str(report.report_id),
                    'staffId': report.staff.staff_number,
                    'name': report.staff.user.get_full_name(),
                    'error': f'Workload is not in Pending Distribution state (current: {report.status})',
                    'errorCode': 'NOT_PENDING',
                })
                continue

            if report.distributed_at is not None:
                failed.append({
                    'workloadId': str(report.report_id),
                    'staffId': report.staff.staff_number,
                    'name': report.staff.user.get_full_name(),
                    'error': 'Workload has already been distributed',
                    'errorCode': 'ALREADY_DISTRIBUTED',
                })
                continue

            # ── Check 4: staff must be active ──────────────────────────────────
            if not report.staff.is_active:
                failed.append({
                    'workloadId': str(report.report_id),
                    'staffId': report.staff.staff_number,
                    'name': report.staff.user.get_full_name(),
                    'error': 'Staff member is not active',
                    'errorCode': 'STAFF_INACTIVE',
                })
                continue

            # ── Check 5: required fields must be present ────────────────────────
            if not (report.academic_year and report.semester and
                    report.snapshot_fte is not None and report.snapshot_department_id):
                failed.append({
                    'workloadId': str(report.report_id),
                    'staffId': report.staff.staff_number,
                    'name': report.staff.user.get_full_name(),
                    'error': 'Workload is missing required fields (year, semester, FTE, or department)',
                    'errorCode': 'MISSING_FIELDS',
                })
                continue

            # ── Check 6: total work hours must be within valid range ────────────
            items = list(report.items.all())
            anomaly_result = evaluate_mvp_anomaly(report)
            research_hrs = float(anomaly_result['metrics']['research_pts']) * 17.25
            items_hours = float(sum((workload_item_hours_for_totals(i) for i in items), Decimal('0.00')))
            total_hours = round(items_hours + research_hrs, 2)
            fte = float(report.snapshot_fte)
            if fte > 0 and (total_hours <= 856 * fte or total_hours > 864 * fte):
                failed.append({
                    'workloadId': str(report.report_id),
                    'staffId': report.staff.staff_number,
                    'name': report.staff.user.get_full_name(),
                    'error': (
                        f'Total work hours ({total_hours}h) is outside the valid range '
                        f'({856 * fte:.2f}h – {864 * fte:.2f}h)'
                    ),
                    'errorCode': 'HOURS_OUT_OF_RANGE',
                })
                continue

            # ── Check 7: record distribution timestamp, do NOT change status ──
            # Status (INITIAL→PENDING→APPROVED/REJECTED) belongs to the
            # academic→HoD workflow.  Distribution is a separate event tracked
            # via distributed_at so the workflow status is never contaminated.
            previous_assigned_by = report.assigned_by
            report.distributed_at = now
            report.assigned_by = request.staff
            report.save(update_fields=['distributed_at', 'assigned_by', 'updated_at'])

            academic_visible = WorkloadReport.objects.filter(
                report_id=report.report_id,
                staff=report.staff,
                is_current=True,
                distributed_at__isnull=False,
            ).exists()
            if not academic_visible:
                report.distributed_at = None
                report.assigned_by = previous_assigned_by
                report.save(update_fields=['distributed_at', 'assigned_by', 'updated_at'])
                failed.append({
                    'workloadId': str(report.report_id),
                    'staffId': report.staff.staff_number,
                    'name': report.staff.user.get_full_name(),
                    'error': 'Distribution did not create an Academic-visible workload record',
                    'errorCode': 'ACADEMIC_VISIBILITY_FAILED',
                })
                continue
            AuditLog.objects.create(
                report=report,
                action_by=request.staff,
                action_type='DISTRIBUTED',
                changes={
                    'action': 'distribute',
                    'distributed_by': operated_by,
                    'distributed_at': now.isoformat(),
                },
            )

            # ── Check 8: send in-app message + email notification (non-fatal) ──
            try:
                from api.models import Message
                notification_body = (
                    f'Your workload for {report.academic_year} {report.semester} '
                    f'has been distributed by {operated_by}.'
                )
                Message.objects.create(
                    thread_key=f'{report.staff.staff_number}:admin',
                    sender=request.staff,
                    body=notification_body,
                )
                recipient_email = report.staff.user.email
                if recipient_email:
                    send_mail(
                        subject=f'Workload Distributed — {report.academic_year} {report.semester}',
                        message=notification_body,
                        from_email=None,
                        recipient_list=[recipient_email],
                        fail_silently=True,
                    )
            except Exception:
                pass

            succeeded.append({
                'workloadId': str(report.report_id),
                'staffId': report.staff.staff_number,
                'name': report.staff.user.get_full_name(),
                'status': 'approved',
                'distributedTime': now_str,
                'operatedBy': operated_by,
            })

        except Exception as exc:
            # ── Check 9: unknown error fallback ────────────────────────────────
            failed.append({
                'workloadId': str(report.report_id),
                'staffId': report.staff.staff_number,
                'name': report.staff.user.get_full_name(),
                'error': f'Unexpected error: {exc}',
                'errorCode': 'UNKNOWN_ERROR',
            })

    cycle_advanced = False
    if succeeded:
        active_year, active_semester = _ensure_ops_active_cycle(request.staff)
        cycle_advanced = _ops_cycle_rank(year_int, semester) != _ops_cycle_rank(active_year, active_semester)
        _persist_ops_cycle(
            year_int,
            semester,
            request.staff,
            source='manual-distribution',
        )
        WorkloadDistributionJob.objects.create(
            academic_year=year_int,
            semester=semester,
            triggered_by=request.staff,
            notes=(
                f'Processed {len(succeeded)} workload(s); '
                f'failed {len(failed)}; active cycle set to {year_int}-{semester}.'
            ),
        )

    return Response({
        'success': True,
        'data': {
            'processedCount': len(succeeded),
            'failedCount': len(failed),
            'items': succeeded,
            'failed': failed,
            'currentPeriod': {
                'year': year_int if succeeded else _ensure_ops_active_cycle(request.staff)[0],
                'semester': semester if succeeded else _ensure_ops_active_cycle(request.staff)[1],
                'label': _ops_period_label(
                    year_int if succeeded else _ensure_ops_active_cycle(request.staff)[0],
                    semester if succeeded else _ensure_ops_active_cycle(request.staff)[1],
                ),
            },
            'cycleAdvanced': cycle_advanced,
        },
    }, status=http_status.HTTP_201_CREATED)


def _write_workbook(headers, rows):
    try:
        import openpyxl
    except ImportError:
        return None

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def _materialize_template(relative_path: Path, headers, sample_rows=None):
    buffer = _write_workbook(headers, sample_rows or [])
    if buffer is None:
        return False, None

    destination = relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(buffer.getvalue())
    return True, destination


def _admin_template_urls(request, subpath_suffix: str, filename: str, headers, sample_rows):
    """
    Returns JSON contract plus real download endpoints for environments without public MEDIA access.
    """
    media_dir = _ensure_media_subdir(TEMPLATE_MEDIA_SUBDIR)
    target = media_dir / filename
    ok, disk_path = _materialize_template(target, headers, sample_rows)
    if not ok:
        return Response(
            {'success': False, 'message': 'Template unavailable: openpyxl not installed'},
            status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    download_url = request.build_absolute_uri(f'/api/admin/{subpath_suffix}/download/')
    return Response({
        'success': True,
        'message': 'Template ready',
        'data': {
            'file_name': filename,
            'download_url': download_url,
        },
    })


def _dispatch_template_download(request, filename: str):
    media_dir = _ensure_media_subdir(TEMPLATE_MEDIA_SUBDIR)
    target = media_dir / filename
    if not target.exists():
        return Response({'success': False, 'message': 'Template missing; regenerate listing first.'}, status=404)
    safe_name = re.sub(r'[^A-Za-z0-9_.-]', '_', filename)
    # Read into memory first to avoid Windows file-handle lock (WinError 32).
    payload = target.read_bytes()
    response = HttpResponse(payload, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = f'attachment; filename="{safe_name}"'
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_workload_import_template(request):
    headers = ['employee_id', 'name', 'description', 'total_work_hours', 'status']
    return _admin_template_urls(request, 'workloads/import-template', 'Workload_Template.xlsx', headers, [])


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_workload_import_template_download(request):
    return _dispatch_template_download(request, 'Workload_Template.xlsx')


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_staff_import_template(request):
    headers = ['employee_id', 'first_name', 'last_name', 'email', 'department', 'active_status']
    return _admin_template_urls(request, 'staff/import-template', 'Staff_Template.xlsx', headers, [])


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_staff_import_template_download(request):
    return _dispatch_template_download(request, 'Staff_Template.xlsx')


@api_view(['POST'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@throttle_classes([AdminImportThrottle])
@transaction.atomic
def admin_workload_import(request):
    """POST /api/school-operations/workloads/import  (also /api/admin/workloads/import/)

    Accepts JSON body from the frontend (browser-parsed workbook data).
    The old Excel file-upload path is no longer the primary interface.
    """
    body = request.data or {}
    sheets = body.get('sheets')
    if not isinstance(sheets, list) or not sheets:
        return Response(
            {'success': False, 'message': 'sheets must be a non-empty list'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    batch_id = uuid.uuid4()
    created_count = 0
    updated_count = 0
    failed_count = 0
    failures = []
    active_year, active_semester = _ensure_ops_active_cycle(request.staff)
    requested_year = body.get('academicYear') or body.get('year')
    try:
        default_year = int(requested_year) if requested_year not in (None, '') else active_year
    except (TypeError, ValueError):
        default_year = active_year

    for sheet in sheets:
        sheet_name = sheet.get('sheetName', '')
        # Infer semester from sheet name: "Sem1" → S1, "Sem2" → S2
        sem_raw = str(sheet_name).strip()
        if '1' in sem_raw:
            semester = 'S1'
        elif '2' in sem_raw:
            semester = 'S2'
        else:
            semester = active_semester

        anomaly_metrics = sheet.get('anomalyMetricsByStaffId') or {}
        teaching_lines = sheet.get('teachingLinesByStaffId') or {}
        hdr_metrics = sheet.get('hdrMetricsByStaffId') or {}
        service_metrics = sheet.get('serviceMetricsByStaffId') or {}
        role_metrics = sheet.get('roleMetricsByStaffId') or {}

        # Build a per-staff map of column-J (targetTeachingPct) and column-F (hodReview)
        # from the first row for each staff (rows carry raw cellsByColumn).
        row_meta_by_staff: dict = {}
        for raw_row in (sheet.get('rows') or []):
            cells = raw_row.get('cellsByColumn') or {}
            sid = str(cells.get('C') or '').strip()
            if sid and sid not in row_meta_by_staff:
                row_meta_by_staff[sid] = {
                    'targetTeachingPct': cells.get('J'),
                    'hodReview': str(cells.get('F') or '').strip().lower(),
                    'newStaff': str(cells.get('D') or '').strip().lower(),
                }

        # Collect all staff IDs from this sheet
        all_staff_ids = set(anomaly_metrics.keys()) | set(teaching_lines.keys())

        year_int = default_year

        for staff_number in all_staff_ids:
            # Skip internal placeholder keys used by the frontend parser
            if not staff_number or str(staff_number).startswith('__row:'):
                continue

            staff_row = Staff.objects.select_related('department', 'user').filter(
                staff_number=staff_number
            ).first()
            if not staff_row:
                failures.append({'staffId': staff_number, 'sheet': sheet_name, 'message': 'Staff not found'})
                failed_count += 1
                continue

            try:
                with transaction.atomic():
                    # Block re-import if a non-INITIAL/REJECTED report already exists
                    conflicts = WorkloadReport.objects.filter(
                        staff=staff_row,
                        academic_year=year_int,
                        semester=semester,
                        is_current=True,
                    ).exclude(status__in=['INITIAL', 'REJECTED'])
                    if conflicts.exists():
                        failures.append({'staffId': staff_number, 'sheet': sheet_name, 'message': 'Report locked; rollback required'})
                        failed_count += 1
                        continue

                    orphan_reports = list(WorkloadReport.objects.select_for_update().filter(
                        staff=staff_row,
                        academic_year=year_int,
                        semester=semester,
                        is_current=True,
                    ))

                    # Read anomaly metrics for this staff (target band, FTE, teaching pct).
                    am = anomaly_metrics.get(staff_number) or {}
                    rm = row_meta_by_staff.get(staff_number) or {}
                    fte_val = am.get('fte')
                    target_pct = rm.get('targetTeachingPct')
                    target_band_val = am.get('targetBand')
                    calculated_band_val = am.get('calculatedBand')
                    try:
                        snapshot_fte = Decimal(str(fte_val)) if fte_val is not None else (staff_row.fte if hasattr(staff_row, 'fte') else Decimal('1.00'))
                    except Exception:
                        snapshot_fte = Decimal('1.00')
                    try:
                        target_teaching_pct = Decimal(str(target_pct)) if target_pct is not None else None
                    except Exception:
                        target_teaching_pct = None

                    hod_review_val = rm.get('hodReview') or 'no'
                    hod_review_val = 'yes' if str(hod_review_val).strip().lower() == 'yes' else 'no'
                    if _has_target_band_mismatch(target_band_val, calculated_band_val):
                        hod_review_val = 'yes'
                    new_staff_val = str(rm.get('newStaff') or '').strip().lower() in ('yes', 'true', '1', 'y')

                    # Always force INITIAL — import must never bypass the approval workflow.
                    report = WorkloadReport.objects.create(
                        staff=staff_row,
                        academic_year=year_int,
                        semester=semester,
                        snapshot_fte=snapshot_fte,
                        snapshot_department=staff_row.department,
                        status='INITIAL',
                        assigned_by=request.staff,
                        import_batch_id=batch_id,
                        is_current=True,
                        target_band=str(target_band_val) if target_band_val else None,
                        target_teaching_pct=target_teaching_pct,
                        hod_review=hod_review_val,
                        new_staff=new_staff_val,
                    )

                    for old in orphan_reports:
                        old.is_current = False
                        old.superseded_by = report
                        old.save(update_fields=['is_current', 'superseded_by', 'updated_at'])
                        AuditLog.objects.create(
                            report=old,
                            action_by=request.staff,
                            action_type='MODIFIED_BY_REIMPORT',
                            changes={'superseded_by': str(report.report_id), 'batch': str(batch_id)},
                        )

                    AuditLog.objects.create(
                        report=report,
                        action_by=request.staff,
                        action_type='IMPORTED',
                        changes={'batch': str(batch_id), 'kind': 'JSON_WORKLOAD_IMPORT',
                                 'superseded': [str(r.report_id) for r in orphan_reports]},
                    )

                    # Create WorkloadItems from the parsed sheet data
                    items_to_create = []

                    for line in (teaching_lines.get(staff_number) or []):
                        hrs = Decimal(str(line.get('hours', 0) or 0))
                        if hrs < 0:
                            continue
                        items_to_create.append(WorkloadItem(
                            report=report,
                            category='TEACHING',
                            unit_code=str(line.get('unit', ''))[:50] or None,
                            description='Teaching',
                            allocated_hours=hrs,
                        ))

                    hdr = hdr_metrics.get(staff_number) or {}
                    if hdr:
                        ft_hours = Decimal(str(hdr.get('ftHours', 0) or 0))
                        pt_hours = Decimal(str(hdr.get('ptHours', 0) or 0))
                        hdr_hrs = Decimal(str(hdr.get('totalHrs', 0) or 0))
                        if hdr_hrs <= 0:
                            derived_hrs = Decimal(str(hdr.get('derivedHrs', 0) or 0))
                            hdr_points = Decimal(str(hdr.get('hdrPoints', 0) or 0))
                            if derived_hrs > 0:
                                hdr_hrs = derived_hrs
                            elif ft_hours + pt_hours > 0:
                                hdr_hrs = ft_hours + pt_hours
                            elif hdr_points > 0:
                                hdr_hrs = hdr_points * Decimal('17.25')

                        has_hdr_data = any((
                            ft_hours > 0,
                            pt_hours > 0,
                            hdr_hrs > 0,
                            hdr.get('ftStudents') is not None,
                            hdr.get('ptStudents') is not None,
                        ))
                        if has_hdr_data:
                            items_to_create.extend([
                                WorkloadItem(
                                    report=report,
                                    category='HDR_SUPERVISION',
                                    unit_code=None,
                                    description=f"Full time students ({_format_excel_count(hdr.get('ftStudents'))})",
                                    allocated_hours=ft_hours,
                                ),
                                WorkloadItem(
                                    report=report,
                                    category='HDR_SUPERVISION',
                                    unit_code=None,
                                    description=f"Part time students ({_format_excel_count(hdr.get('ptStudents'))})",
                                    allocated_hours=pt_hours,
                                ),
                            ])
                            if hdr_hrs > 0:
                                items_to_create.append(WorkloadItem(
                                    report=report,
                                    category='HDR_SUPERVISION',
                                    unit_code=None,
                                    description='HDR Total',
                                    allocated_hours=hdr_hrs,
                                ))

                    svc = service_metrics.get(staff_number) or {}
                    svc_pts = Decimal(str(svc.get('servicePoints', 0) or 0))
                    svc_hrs = svc_pts * Decimal('17.25')
                    if svc_hrs > 0:
                        items_to_create.append(WorkloadItem(
                            report=report,
                            category='SERVICE',
                            unit_code=None,
                            description='Self-Directed Svc Pts',
                            allocated_hours=svc_hrs,
                        ))

                    for role in (role_metrics.get(staff_number) or {}).get('roles', []):
                        role_hrs = Decimal(str(role.get('hours', 0) or 0))
                        if role_hrs > 0:
                            items_to_create.append(WorkloadItem(
                                report=report,
                                category='ASSIGNED_ROLE',
                                unit_code=None,
                                description=str(role.get('name', 'Role'))[:500],
                                allocated_hours=role_hrs,
                            ))

                    if items_to_create:
                        WorkloadItem.objects.bulk_create(items_to_create)

                    if orphan_reports:
                        updated_count += 1
                    else:
                        created_count += 1

            except Exception as exc:
                failures.append({
                    'staffId': staff_number,
                    'sheet': sheet_name,
                    'message': f'Unexpected error: {exc}',
                })
                failed_count += 1

    return Response({
        'ok': True,
        'referenceId': str(batch_id),
        'created': created_count,
        'updated': updated_count,
        'failed': failed_count,
        'errors': failures,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@throttle_classes([AdminImportThrottle])
@transaction.atomic
def admin_staff_import(request):
    """POST /api/school-operations/staff/import  (also /api/admin/staff/import/)

    Accepts JSON body: { "rows": [ { staffId, firstName, lastName, email, title,
    department, isActive } ] }
    Creates or updates ACADEMIC staff rows for Ops academic imports.
    """
    body = request.data or {}
    rows = body.get('rows')
    if not isinstance(rows, list) or not rows:
        return Response(
            {'success': False, 'message': 'rows must be a non-empty list'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    created_count = 0
    updated_count = 0
    failures = []
    allowed_department_map = {name.lower(): name for name in ACADEMIC_IMPORT_DEPARTMENTS}

    for idx, row in enumerate(rows):
        staff_number = str(row.get('staffId') or row.get('staff_id') or '').strip()
        if not re.fullmatch(r'\d{8}', staff_number):
            failures.append({'index': idx, 'staffId': staff_number, 'message': 'staffId must be exactly 8 digits'})
            continue

        first_name = str(row.get('firstName') or row.get('first_name') or '').strip()[:150]
        last_name = str(row.get('lastName') or row.get('last_name') or '').strip()[:150]
        email_clean = str(row.get('email') or '').strip().lower()
        title = str(row.get('title') or '').strip()[:100]
        dept_raw = str(row.get('department') or '').strip()
        is_active = _coerce_import_bool(
            row.get('isActive') if 'isActive' in row else row.get('active_status'),
            default=True,
        )

        if not first_name:
            failures.append({'index': idx, 'staffId': staff_number, 'message': 'firstName is required'})
            continue
        if not last_name:
            failures.append({'index': idx, 'staffId': staff_number, 'message': 'lastName is required'})
            continue
        if not email_clean:
            failures.append({'index': idx, 'staffId': staff_number, 'message': 'email is required'})
            continue
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email_clean):
            failures.append({'index': idx, 'staffId': staff_number, 'message': 'invalid email'})
            continue
        if not dept_raw:
            failures.append({'index': idx, 'staffId': staff_number, 'message': 'department is required'})
            continue

        dept = Department.objects.filter(name__iexact=dept_raw).first()
        if not dept:
            canonical_department = allowed_department_map.get(dept_raw.lower())
            if not canonical_department:
                failures.append({'index': idx, 'staffId': staff_number, 'message': 'department not found'})
                continue
            dept = Department.objects.create(name=canonical_department)

        staff_row = Staff.objects.select_related('user', 'department').filter(staff_number=staff_number).first()
        created_this_row = staff_row is None
        user_obj = staff_row.user if staff_row else None
        if user_obj is None:
            user_obj = User.objects.filter(username=staff_number).first()

        before_snapshot = {
            'first_name': user_obj.first_name if user_obj else '',
            'last_name': user_obj.last_name if user_obj else '',
            'email': user_obj.email if user_obj else '',
            'department': staff_row.department.name if staff_row and staff_row.department_id else '',
            'title': staff_row.title if staff_row else '',
            'is_active': staff_row.is_active if staff_row else True,
        }

        with transaction.atomic():
            if user_obj is None:
                user_obj = User(username=staff_number)
                user_obj.set_unusable_password()

            user_obj.username = staff_number
            user_obj.first_name = first_name
            user_obj.last_name = last_name
            user_obj.email = email_clean
            user_obj.is_active = bool(is_active)
            if user_obj.pk:
                user_obj.save(update_fields=['username', 'first_name', 'last_name', 'email', 'is_active'])
            else:
                user_obj.save()

            if staff_row is None:
                staff_row = Staff.objects.create(
                    user=user_obj,
                    staff_number=staff_number,
                    department=dept,
                    role='ACADEMIC',
                    title=title,
                    is_active=bool(is_active),
                )
            else:
                staff_row.department = dept
                staff_row.title = title
                staff_row.is_active = bool(is_active)
                if not staff_row.role:
                    staff_row.role = 'ACADEMIC'
                staff_row.save()

        after_snapshot = {
            'first_name': user_obj.first_name,
            'last_name': user_obj.last_name,
            'email': user_obj.email,
            'department': staff_row.department.name if staff_row.department_id else '',
            'title': staff_row.title,
            'is_active': staff_row.is_active,
        }
        diffs = compute_diffs(
            before_snapshot,
            after_snapshot,
            field_labels={
                'first_name': 'First name',
                'last_name': 'Last name',
                'email': 'Email',
                'department': 'Department',
                'title': 'Title',
                'is_active': 'Active',
            },
        )
        if diffs:
            # HoS imports the role-assignment template; Ops imports the staff-profile
            # template. Both hit this endpoint — we tag the source by caller role so
            # the audit export can tell them apart.
            import_source = (
                'HOS_ROLE_ASSIGNMENT' if request.staff.role == 'HOS' else 'STAFF_IMPORT'
            )
            write_audit(
                action_type='PROFILE_EDIT',
                action_by=request.staff,
                report=None,
                source=import_source,
                diffs=diffs,
                staff_number=staff_row.staff_number,
            )

        if created_this_row:
            created_count += 1
        else:
            updated_count += 1

    return Response({
        'ok': True,
        'created': created_count,
        'updated': updated_count,
        'errors': failures,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_staff_list(request):
    """GET /api/school-operations/staff  (also /api/admin/staff/)"""
    queryset = Staff.objects.select_related('user', 'department').filter(role='ACADEMIC').order_by('staff_number')

    # New contract query params
    staff_id = request.GET.get('staff_id', '').strip()
    if staff_id:
        queryset = queryset.filter(staff_number=staff_id)

    first_name = request.GET.get('first_name', '').strip()
    if first_name:
        queryset = queryset.filter(user__first_name__icontains=first_name)

    last_name = request.GET.get('last_name', '').strip()
    if last_name:
        queryset = queryset.filter(user__last_name__icontains=last_name)

    # Legacy search param
    search_term = request.GET.get('query', '').strip()
    if search_term:
        queryset = queryset.filter(
            models.Q(user__first_name__icontains=search_term)
            | models.Q(user__last_name__icontains=search_term)
            | models.Q(staff_number__icontains=search_term)
        )

    try:
        page = max(1, int(request.GET.get('page', 1)))
        page_size = max(1, min(100, int(request.GET.get('page_size', 10))))
    except (ValueError, TypeError):
        return Response({'success': False, 'message': 'invalid pagination'}, status=400)

    paginator = Paginator(queryset, page_size)
    page_obj = paginator.get_page(page)

    return Response({
        'success': True,
        'message': 'Staff roster loaded',
        'data': {
            'items': [_serialize_staff_row(s) for s in page_obj.object_list],
            'pagination': {
                'page': page_obj.number,
                'pageSize': page_size,
                'totalItems': paginator.count,
                'totalPages': paginator.num_pages,
            },
        },
    })


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@transaction.atomic
def admin_staff_patch(request, staff_id):
    """GET /api/school-operations/staff/{staffId}  or  PATCH /api/school-operations/staff/{staffId}"""
    staff_row = _staff_from_body_or_path(request, staff_id)

    if request.method == 'GET':
        return Response({
            'success': True,
            'message': 'Staff detail loaded',
            'data': _serialize_staff_row(staff_row),
        })

    # PATCH — accept both camelCase (new contract) and snake_case (legacy)
    payload = request.data or {}

    first_name = payload.get('firstName') if 'firstName' in payload else payload.get('first_name')
    last_name = payload.get('lastName') if 'lastName' in payload else payload.get('last_name')
    email = payload.get('email')
    dept_name = payload.get('department')
    title = payload.get('title')
    is_active = payload.get('isActive') if 'isActive' in payload else (
        None if 'active_status' not in payload else (payload.get('active_status', '').lower() != 'inactive')
    )
    user_obj = staff_row.user
    # Snapshot before any mutation so the diff reflects the user's intent, not post-save state.
    before_snapshot = {
        'first_name': user_obj.first_name,
        'last_name': user_obj.last_name,
        'email': user_obj.email,
        'department': staff_row.department.name if staff_row.department_id else '',
        'title': staff_row.title,
        'is_active': staff_row.is_active,
    }
    user_fields = []

    if first_name is not None:
        user_obj.first_name = str(first_name).strip()[:150]
        user_fields.append('first_name')
    if last_name is not None:
        user_obj.last_name = str(last_name).strip()[:150]
        user_fields.append('last_name')
    if email is not None:
        email_clean = str(email).strip().lower()
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email_clean):
            return Response({'success': False, 'message': 'invalid email'}, status=http_status.HTTP_400_BAD_REQUEST)
        user_obj.email = email_clean
        user_fields.append('email')

    if user_fields:
        user_obj.save(update_fields=list(set(user_fields)))

    staff_fields = []
    if dept_name:
        department = Department.objects.filter(name__iexact=str(dept_name).strip()).first()
        if not department:
            return Response({'success': False, 'message': 'department not found'}, status=http_status.HTTP_400_BAD_REQUEST)
        staff_row.department = department
        staff_fields.append('department')

    if title is not None:
        staff_row.title = str(title).strip()[:100]
        staff_fields.append('title')

    if is_active is not None:
        staff_row.is_active = bool(is_active)
        staff_fields.append('is_active')

    if staff_fields:
        staff_fields.append('updated_at')
        staff_row.save(update_fields=staff_fields)

    after_snapshot = {
        'first_name': user_obj.first_name,
        'last_name': user_obj.last_name,
        'email': user_obj.email,
        'department': staff_row.department.name if staff_row.department_id else '',
        'title': staff_row.title,
        'is_active': staff_row.is_active,
    }
    diffs = compute_diffs(
        before_snapshot,
        after_snapshot,
        field_labels={
            'first_name': 'First name',
            'last_name': 'Last name',
            'email': 'Email',
            'department': 'Department',
            'title': 'Title',
            'is_active': 'Active',
        },
    )
    if diffs:
        write_audit(
            action_type='PROFILE_EDIT',
            action_by=request.staff,
            report=None,
            source='STAFF_INLINE_EDIT',
            diffs=diffs,
            staff_number=staff_row.staff_number,
        )

    return Response({
        'ok': True,
        'staff': _serialize_staff_row(staff_row),
    })


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@transaction.atomic
def admin_role_assignments(request):
    """GET list + POST create."""
    if request.method == 'GET':
        queryset = StaffRoleAssignment.objects.select_related('staff', 'resolved_department').order_by('-created_at')
        include_disabled = (
            str(request.GET.get('includeDisabled') or request.GET.get('include_disabled') or '')
            .strip()
            .lower()
            in ('1', 'true', 'yes')
        )
        if include_disabled:
            assignments = list(queryset[:500])
        else:
            assignments = _dedupe_latest_assignment_by_staff(list(queryset.filter(status='active')[:500]))
        return Response({'success': True, 'message': 'Assignments loaded', 'data': {
            'items': [_serialize_assignment_row(obj) for obj in assignments],
        }})

    body = request.data or {}
    staff_number = str(body.get('staff_id', '')).strip()
    role_front = body.get('role')
    dept_scope = str(body.get('department', '')).strip()
    permissions = body.get('permissions') or []

    if not staff_number or role_front not in dict(StaffRoleAssignment.FRONT_ROLE_CHOICES):
        return Response({'success': False, 'message': 'staff_id and role are required'}, status=http_status.HTTP_400_BAD_REQUEST)
    if not isinstance(permissions, list):
        return Response({'success': False, 'message': 'permissions must be a list'}, status=http_status.HTTP_400_BAD_REQUEST)

    staff_row = Staff.objects.filter(staff_number=staff_number).first()
    if not staff_row:
        return Response({'success': False, 'message': 'staff not found'}, status=http_status.HTTP_404_NOT_FOUND)

    if role_front == 'Admin':
        resolved = None
    else:
        resolved = Department.objects.filter(name__iexact=dept_scope).first()
        if dept_scope and resolved is None:
            resolved = Department.objects.create(name=dept_scope)

    StaffRoleAssignment.objects.filter(staff=staff_row, status='active').update(
        status='disabled',
        disable_reason=SUPERSEDED_ROLE_REASON,
        updated_at=timezone.now(),
    )

    assignment = StaffRoleAssignment.objects.create(
        staff=staff_row,
        role_code=role_front,
        department_scope=dept_scope,
        resolved_department=resolved,
        permissions=permissions,
        status='active',
    )

    # Keep Staff.role double-written while Django Groups/Permissions drive access.
    _FRONT_TO_CANONICAL = {'HoD': 'HOD', 'Admin': 'SCHOOL_OPS'}
    canonical = _FRONT_TO_CANONICAL.get(role_front)
    if canonical:
        staff_row.role = canonical
        if resolved is not None:
            staff_row.department = resolved
            staff_row.save(update_fields=['role', 'department', 'updated_at'])
        else:
            staff_row.save(update_fields=['role', 'updated_at'])

    return Response({
        'success': True,
        'message': 'Role assigned',
        'data': {
            **_serialize_assignment_row(assignment),
        },
    }, status=http_status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@transaction.atomic
def admin_role_assignment_disable(request, assignment_id):
    payload = request.data or {}
    reason = str(payload.get('reason') or '').strip()

    assignment = get_object_or_404(StaffRoleAssignment, assignment_id=int(assignment_id))
    assignment.status = 'disabled'
    assignment.disable_reason = reason[:500]
    assignment.save(update_fields=['status', 'disable_reason', 'updated_at'])

    latest_active = (
        StaffRoleAssignment.objects
        .filter(staff=assignment.staff, status='active')
        .exclude(assignment_id=assignment.assignment_id)
        .order_by('-created_at', '-assignment_id')
        .first()
    )
    if latest_active is None:
        assignment.staff.role = 'ACADEMIC'
        assignment.staff.save(update_fields=['role', 'updated_at'])
    else:
        canonical = {'HoD': 'HOD', 'Admin': 'SCHOOL_OPS'}.get(latest_active.role_code)
        if canonical:
            assignment.staff.role = canonical
            if latest_active.resolved_department_id is not None:
                assignment.staff.department = latest_active.resolved_department
                assignment.staff.save(update_fields=['role', 'department', 'updated_at'])
            else:
                assignment.staff.save(update_fields=['role', 'updated_at'])
        else:
            assignment.staff.save(update_fields=['role', 'updated_at'])

    return Response({'success': True, 'message': 'Role assignment disabled', 'data': {
        'id': assignment.assignment_id,
        'status': assignment.status,
    }})


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_visualization(request):
    semester_filter = _parse_semester_filter(request)
    year_from, year_to = _parse_year_range(request)
    dept_scope = _parse_department_filter(request)

    queryset = (
        _admin_reports_qs(request.staff)
        .prefetch_related('items')
        .select_related('snapshot_department', 'staff__user')
    )
    queryset = _filter_reports_by_range(queryset, year_from, year_to, semester_filter)
    if dept_scope:
        queryset = queryset.filter(snapshot_department__name=dept_scope)

    payload = _build_visualization_payload(list(queryset), year_from, year_to, semester_filter, dept_scope)

    return Response({'success': True, 'message': 'Visualization loaded', 'data': payload})


def _persist_export_workbook(request):
    """Write Excel to disk and register cache token for owner-only download."""
    try:
        import openpyxl
    except ImportError:
        return None, Response(
            {'success': False, 'message': 'Export unavailable: openpyxl not installed'},
            status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    year_from, year_to = _parse_year_range(request)
    semester_filter = _parse_semester_filter(request)
    dept_scope = _parse_department_filter(request)

    queryset = (
        _admin_reports_qs(request.staff)
        .prefetch_related('items')
        .select_related('staff__user', 'snapshot_department')
        .filter(is_current=True)
        .order_by('snapshot_department__name', 'staff__staff_number', 'academic_year', 'semester')
    )
    queryset = _filter_reports_by_range(queryset, year_from, year_to, semester_filter)
    if dept_scope:
        queryset = queryset.filter(snapshot_department__name=dept_scope)

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = 'Admin Export'
    headers = ['Staff Number', 'Name', 'Department', 'Year', 'Semester', 'Status', 'Hours', 'Category', 'Detail']
    sheet.append(headers)

    export_stamp = timezone.now().isoformat(timespec='seconds')
    total_rows = 0
    for report in queryset:
        staff_user = report.staff.user
        name = staff_user.get_full_name().strip() or staff_user.username
        dept = report.snapshot_department.name
        hours_total = sum((workload_item_hours_for_totals(i) for i in report.items.all()), Decimal('0.00'))

        sheet.append([
            report.staff.staff_number,
            name,
            dept,
            report.academic_year,
            report.semester,
            report.status.lower(),
            float(hours_total),
            '',
            '',
        ])
        for item in report.items.all():
            sheet.append([
                report.staff.staff_number,
                name,
                dept,
                report.academic_year,
                report.semester,
                report.status.lower(),
                float(item.allocated_hours),
                item.category,
                item.unit_code or item.description or '',
            ])
            total_rows += 1

    export_dir = _ensure_media_subdir(EXPORT_MEDIA_SUBDIR)
    token = uuid.uuid4().hex
    fname = Path(f'{token}_Admin_Workload.xlsx')
    buffer = io.BytesIO()
    workbook.save(buffer)
    disk_path = export_dir / fname
    disk_path.write_bytes(buffer.getvalue())

    meta = {'relative': str(fname), 'issued_at': export_stamp}
    cache.set(f'admin_export:{token}', {'staff_uuid': str(request.staff.pk), 'payload': meta}, timeout=900)
    download_url = request.build_absolute_uri(f'/api/admin/export/download/?token={token}')
    return {
        'file_name': 'Admin_Workload.xlsx',
        'download_url': download_url,
        'issued_at': export_stamp,
        'rows_written': total_rows,
    }, None


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@throttle_classes([AdminExportThrottle])
def admin_export_manifest(request):
    """
    Primary contract endpoint returning JSON pointers.

    If cai adjusts export semantics later, swap the implementation behind `_persist_export_workbook`.
    """
    snapshot, error_response = _persist_export_workbook(request)
    if error_response:
        return error_response

    return Response({
        'success': True,
        'message': 'Export prepared',
        'data': snapshot,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@throttle_classes([AdminExportThrottle])
def admin_export_download(request):
    """Binary companion for `/admin/export/` JSON contracts."""
    token = request.GET.get('token')
    entry = cache.get(f'admin_export:{token}')
    if not token or not entry:
        return Response({'success': False, 'message': 'Invalid or expired token'}, status=http_status.HTTP_404_NOT_FOUND)
    if str(entry['staff_uuid']) != str(request.staff.pk):
        return Response({'success': False, 'message': 'Token does not belong to this user'}, status=http_status.HTTP_403_FORBIDDEN)

    fname = Path(entry['payload']['relative'])
    export_dir = _ensure_media_subdir(EXPORT_MEDIA_SUBDIR)
    disk_path = export_dir / fname.name

    if not disk_path.exists():
        return Response({'success': False, 'message': 'File missing'}, status=http_status.HTTP_410_GONE)

    payload_bytes = disk_path.read_bytes()
    disk_path.unlink(missing_ok=True)
    cache.delete(f'admin_export:{token}')

    response = HttpResponse(
        payload_bytes,
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = 'attachment; filename="Admin_Workload.xlsx"'
    return response


def _build_workload_export_workbook(qs):
    """Build an in-memory Excel workbook from a WorkloadReport queryset."""
    try:
        import openpyxl
    except ImportError:
        return None
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Workloads'
    ws.append(['Staff ID', 'Name', 'Department', 'Year', 'Semester', 'Status', 'Hours', 'Category', 'Detail'])
    for report in qs:
        staff_user = report.staff.user
        name = staff_user.get_full_name().strip() or staff_user.username
        for item in report.items.all():
            ws.append([
                report.staff.staff_number,
                name,
                report.snapshot_department.name,
                report.academic_year,
                report.semester,
                report.status.lower(),
                float(item.allocated_hours),
                item.category,
                item.unit_code or item.description or '',
            ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@throttle_classes([AdminExportThrottle])
def admin_workload_export(request):
    """GET /api/school-operations/workloads/export — direct file stream filtered by status/staff/dept/year/semester."""
    status_filter = (request.GET.get('status_filter') or '').lower()
    qs = (
        _admin_reports_qs(request.staff)
        .prefetch_related('items')
        .select_related('staff__user', 'snapshot_department')
    )
    if status_filter == 'distributed':
        qs = qs.filter(status='APPROVED')
    elif status_filter == 'failed':
        qs = qs.filter(status='REJECTED')
    elif status_filter == 'superseded':
        qs = get_workload_queryset(request.staff).filter(is_current=False).prefetch_related('items').select_related(
            'staff__user', 'snapshot_department'
        )

    staff_id = request.GET.get('staff_id', '').strip()
    if staff_id:
        qs = qs.filter(staff__staff_number=staff_id)

    name = request.GET.get('name', '').strip()
    if name:
        qs = qs.filter(
            models.Q(staff__user__first_name__icontains=name)
            | models.Q(staff__user__last_name__icontains=name)
        )

    dept_name = _parse_department_filter(request)
    if dept_name:
        qs = qs.filter(snapshot_department__name=dept_name)

    year = request.GET.get('year', '').strip()
    if year:
        qs = qs.filter(academic_year=year)

    semester = request.GET.get('semester', '').strip()
    if semester and semester.upper() != 'ALL':
        qs = qs.filter(semester=semester.upper())

    payload = _build_workload_export_workbook(qs)
    if payload is None:
        return Response({'success': False, 'message': 'Export unavailable: openpyxl not installed'}, status=503)

    response = HttpResponse(payload, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = 'attachment; filename="Workloads_Export.xlsx"'
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@throttle_classes([AdminExportThrottle])
def admin_school_export(request):
    """GET /api/school-operations/export — school-level history Excel, direct file stream."""
    year_from, year_to = _parse_year_range(request)
    semester_filter = _parse_semester_filter(request)
    dept_scope = _parse_department_filter(request)

    qs = (
        _admin_reports_qs(request.staff)
        .prefetch_related('items')
        .select_related('staff__user', 'snapshot_department')
        .order_by('snapshot_department__name', 'staff__staff_number', 'academic_year', 'semester')
    )
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter)
    if dept_scope:
        qs = qs.filter(snapshot_department__name=dept_scope)

    payload = _build_workload_export_workbook(qs)
    if payload is None:
        return Response({'success': False, 'message': 'Export unavailable: openpyxl not installed'}, status=503)

    response = HttpResponse(payload, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = 'attachment; filename="School_Workload_History.xlsx"'
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
def admin_contact_staff(request):
    """POST /api/school-operations/contact-staff — stub; stores message as AuditLog comment."""
    body = request.data or {}
    recipient_id = str(body.get('recipientStaffId', '')).strip()
    message_body = str(body.get('messageBody', '')).strip()

    if not recipient_id:
        return Response({'success': False, 'message': 'recipientStaffId is required'}, status=http_status.HTTP_400_BAD_REQUEST)
    if not message_body:
        return Response({'success': False, 'message': 'messageBody is required'}, status=http_status.HTTP_400_BAD_REQUEST)
    if len(message_body) > 2000:
        return Response({'success': False, 'message': 'messageBody must be <= 2000 characters'}, status=http_status.HTTP_400_BAD_REQUEST)

    recipient = Staff.objects.filter(staff_number=recipient_id).first()
    if not recipient:
        return Response({'success': False, 'message': 'Recipient staff not found'}, status=http_status.HTTP_404_NOT_FOUND)

    ref_id = f'msg_{uuid.uuid4().hex[:8]}'
    # Store as an audit entry on the recipient's most recent current report (best-effort).
    latest_report = WorkloadReport.objects.filter(staff=recipient, is_current=True).order_by('-updated_at').first()
    if latest_report:
        AuditLog.objects.create(
            report=latest_report,
            action_by=request.staff,
            action_type='CONTACT_STAFF',
            comment=message_body,
            changes={'referenceId': ref_id, 'recipientStaffId': recipient_id},
        )

    return Response({'ok': True, 'referenceId': ref_id})


# ─── Audit-log export (Export 2 from changehistory+.md §2 "决策 C") ────────────

# Surface these action_types in the audit export. Anything else stays in the DB
# but is not considered "material" to the compliance trail.
_AUDIT_EXPORT_ACTIONS = [
    'IMPORTED',
    'MODIFIED_BY_REIMPORT',
    'IMPORT_SKIP',
    'WORKLOAD_EDIT',
    'PROFILE_EDIT',
    'APPROVE',
    'REJECT',
    'CONFIRMATION',
    'SUBMIT_REQUEST',
]

_AUDIT_ACTION_HUMAN = {
    'IMPORTED': 'Imported from Excel',
    'MODIFIED_BY_REIMPORT': 'Superseded by re-import',
    'IMPORT_SKIP': 'Import skipped (protected)',
    'APPROVE': 'Approved',
    'REJECT': 'Rejected',
    'CONFIRMATION': 'Confirmed by academic',
    'SUBMIT_REQUEST': 'Approval request submitted',
    'WORKLOAD_EDIT': 'Workload edited',
    'PROFILE_EDIT': 'Profile edited',
}


@api_view(['GET'])
@permission_classes([IsAuthenticated, CanAccessSchoolOpsApi])
@throttle_classes([AdminExportThrottle])
def admin_audit_log_export(request):
    """GET /api/school-operations/audit-log/export

    Export 2 — the audit trail flat file. One row per (AuditLog, changed field):
    if a single PROFILE_EDIT changed `email` and `department`, the export
    produces two rows so each field's before/after is on its own line.

    Query params (all optional):
        date_from, date_to  ISO date (inclusive) filtering AuditLog.created_at
        action_type         restrict to a single action_type
        staff_id            filter by changes.staff_number OR report.staff.staff_number
    """
    try:
        import openpyxl
    except ImportError:
        return Response(
            {'success': False, 'message': 'Export unavailable: openpyxl not installed'},
            status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    qs = (
        AuditLog.objects
        .filter(action_type__in=_AUDIT_EXPORT_ACTIONS)
        .select_related('action_by__user', 'report__staff__user')
        .order_by('-created_at')
    )

    date_from = (request.GET.get('date_from') or '').strip()
    date_to = (request.GET.get('date_to') or '').strip()
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)

    action_type = (request.GET.get('action_type') or '').strip()
    if action_type:
        qs = qs.filter(action_type=action_type)

    staff_id = (request.GET.get('staff_id') or '').strip()
    if staff_id:
        qs = qs.filter(
            models.Q(changes__staff_number=staff_id)
            | models.Q(report__staff__staff_number=staff_id)
        )

    # Cap at 10k rows to keep export latency bounded — at higher volumes Ops
    # should narrow by date_from/date_to rather than pulling the whole history.
    qs = qs[:10000]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Change History'
    ws.append([
        'Timestamp',
        'Action',
        'Source',
        'Performed By',
        'Role',
        'Staff Affected',
        'Report ID',
        'Field Changed',
        'Before',
        'After',
        'Comment',
    ])

    for log in qs:
        actor_user = log.action_by.user if log.action_by else None
        actor_name = (
            (actor_user.get_full_name().strip() or actor_user.username)
            if actor_user else 'System'
        )
        actor_role = log.action_by.role if log.action_by else ''
        changes = log.changes or {}
        source = changes.get('source') or changes.get('kind') or ''

        # Resolve staff-affected: profile edits carry it in changes.staff_number;
        # workload actions resolve via report.staff.
        staff_affected = changes.get('staff_number', '')
        if not staff_affected and log.report_id and log.report.staff_id:
            staff_affected = log.report.staff.staff_number

        report_id_str = str(log.report_id) if log.report_id else ''
        action_label = _AUDIT_ACTION_HUMAN.get(log.action_type, log.action_type)
        ts_str = log.created_at.strftime('%Y-%m-%d %H:%M:%S')

        diffs = changes.get('diffs') or []
        if diffs:
            # One row per field touched.
            for d in diffs:
                ws.append([
                    ts_str,
                    action_label,
                    source,
                    actor_name,
                    actor_role,
                    staff_affected,
                    report_id_str,
                    d.get('field', ''),
                    d.get('before', ''),
                    d.get('after', ''),
                    log.comment or '',
                ])
        else:
            # Non-diff actions (APPROVE / REJECT / IMPORTED / CONFIRMATION) still
            # need one row so the trail shows they happened.
            ws.append([
                ts_str,
                action_label,
                source,
                actor_name,
                actor_role,
                staff_affected,
                report_id_str,
                '',
                '',
                '',
                log.comment or '',
            ])

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.read(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = 'attachment; filename="Change_History.xlsx"'
    return response
