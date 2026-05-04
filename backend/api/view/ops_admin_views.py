"""
School Operations (/admin contract) endpoints.

Authenticated roles: SCHOOL_OPS, HOS (school-wide visibility, aligns with Supervisor ops usage).

Export contract note (frontend_api_contract_cn.md §10.9):
First response returns JSON metadata; binaries are streamed from /export/download/.
This separation is deliberate so we can swap in async export / signed URLs later.
Comments are English-only per project guideline.
"""

import io
import re
import uuid
from decimal import Decimal
from pathlib import Path

from django.conf import settings

from django.core.cache import cache
from django.core.paginator import Paginator
from django.db import models, transaction
from django.http import FileResponse, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from api.decorators import require_role
from api.models import (
    AuditLog,
    Department,
    Staff,
    StaffRoleAssignment,
    WorkloadDistributionJob,
    WorkloadItem,
    WorkloadReport,
)
from api.services.workload_service import (
    get_workload_queryset,
    _filter_reports_by_range,
    _parse_year_range,
    persist_report_anomaly,
)
from api.view.supervisor_views import (
    _get_request_reason,
    _get_supervisor_note,
    _parse_breakdown_data,
    _serialize_breakdown,
    _serialize_report_row,
    _to_decimal_hours,
)

ADMIN_ROLES = ('SCHOOL_OPS', 'HOS')
MAX_EXCEL_UPLOAD_BYTES = 5 * 1024 * 1024
EXPORT_MEDIA_SUBDIR = 'exports'
TEMPLATE_MEDIA_SUBDIR = 'templates'


class AdminImportThrottle(UserRateThrottle):
    rate = '30/hour'


class AdminExportThrottle(UserRateThrottle):
    rate = '60/hour'


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


def _normalize_front_status(value: str):
    cleaned = (value or '').strip().lower()
    if cleaned in {'initial', 'pending', 'approved', 'rejected'}:
        return cleaned.upper()
    return None


def _serialize_staff_row(staff_row: Staff):
    user_obj = staff_row.user
    name = user_obj.get_full_name().strip() or user_obj.username
    return {
        'staff_id': staff_row.staff_number,
        'employee_id': staff_row.staff_number,
        'first_name': user_obj.first_name or '',
        'last_name': user_obj.last_name or '',
        'email': user_obj.email or '',
        'full_name': name,
        'title': '',
        'department': staff_row.department.name,
        'active_status': 'Active' if staff_row.is_active else 'Inactive',
        'canonical_role': staff_row.role,
    }


def _serialize_assignment_row(obj: StaffRoleAssignment):
    return {
        'id': obj.assignment_id,
        'staff_id': obj.staff.staff_number,
        'role': obj.role_code,
        'department': obj.department_scope,
        'permissions': obj.permissions or [],
        'status': obj.status,
    }


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
        total_h = sum((i.allocated_hours for i in report.items.all()), Decimal('0.00'))
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
        hrs = sum((i.allocated_hours for i in report.items.all()), Decimal('0.00'))
        entry[dept_name] = float(round(Decimal(str(entry.get(dept_name, 0))) + hrs, 2))

    workload_trend = [trend_map[key] for key in sorted(trend_map.keys())]

    total_hours_all = Decimal('0.00')
    for report in reports_queryset:
        total_hours_all += sum((i.allocated_hours for i in report.items.all()), Decimal('0.00'))
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
        'reporting_period_label': reporting_period_label,
        'scope_label': scope_label,
        'summary': {
            'total_departments': len(departments),
            'total_academics': len(academics_union),
            'total_work_hours': float(round(total_hours_all, 2)),
            'pending_requests': pending_total,
            'approved_requests': approved_total,
            'rejected_requests': rejected_total,
        },
        'department_stats': department_stats,
        'workload_trend': workload_trend,
    }


def _staff_from_body_or_path(request, lookup_id: str):
    """Resolve staff rows using immutable staff_number identifiers from the contracts."""
    return get_object_or_404(Staff, staff_number=lookup_id.strip())


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
def admin_workload_requests(request):
    """GET /api/admin/workload-requests/"""
    base_qs = _admin_reports_qs(request.staff).prefetch_related('items').select_related(
        'staff__user', 'snapshot_department'
    )

    qs = base_qs
    status_filter = (request.GET.get('status') or 'all').lower()
    if status_filter == 'initial':
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

    dept_name = _parse_department_filter(request)
    if dept_name:
        qs = qs.filter(snapshot_department__name=dept_name)

    title = request.GET.get('title', '').strip()
    if title:
        # Staff profile has no title column yet — ignore silently to avoid wiping the grid.
        pass

    year = request.GET.get('year', '').strip()
    if year:
        qs = qs.filter(academic_year=year)

    semester = request.GET.get('semester', '').strip()
    if semester:
        qs = qs.filter(semester=semester.upper())

    qs = qs.order_by('-updated_at')

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
        'message': 'Admin workload requests loaded',
        'data': {
            'summary': summary,
            'page': current_page.number,
            'page_size': page_size,
            'total': paginator.count,
            'items': list(current_page.object_list),
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
def admin_workload_request_detail(request, id):
    """GET /api/admin/workload-requests/{id}/"""
    qs = (
        _admin_reports_qs(request.staff)
        .prefetch_related('items')
        .select_related('staff__user', 'snapshot_department')
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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
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
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
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
    report = get_object_or_404(qs, report_id=id)

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
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
@transaction.atomic
def admin_distribute_workloads(request):
    """POST /api/admin/workloads/distribute/ — persists audit metadata for later automation."""
    year = request.data.get('year')
    semester = (request.data.get('semester') or '').strip().upper()

    try:
        year_int = int(year)
    except (TypeError, ValueError):
        return Response(
            {'success': False, 'message': 'year must be a valid integer'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if not _distribution_year_bounds(year_int):
        return Response(
            {'success': False, 'message': 'year outside allowed range (2000-2100)'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if semester not in {'S1', 'S2'}:
        return Response(
            {'success': False, 'message': 'semester must be S1 or S2'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    job = WorkloadDistributionJob.objects.create(
        academic_year=year_int,
        semester=semester,
        triggered_by=request.staff,
        notes='Queued via admin portal',
    )

    return Response({
        'success': True,
        'message': 'Workload distributed successfully',
        'data': {
            'year': year_int,
            'semester': semester,
            'job_id': job.job_id,
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
    handle = target.open('rb')
    response = FileResponse(handle, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = f'attachment; filename="{safe_name}"'
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
def admin_workload_import_template(request):
    headers = ['employee_id', 'name', 'description', 'total_work_hours', 'status']
    return _admin_template_urls(request, 'workloads/import-template', 'Workload_Template.xlsx', headers, [])


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
def admin_workload_import_template_download(request):
    return _dispatch_template_download(request, 'Workload_Template.xlsx')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
def admin_staff_import_template(request):
    headers = ['employee_id', 'first_name', 'last_name', 'email', 'department', 'active_status']
    return _admin_template_urls(request, 'staff/import-template', 'Staff_Template.xlsx', headers, [])


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
def admin_staff_import_template_download(request):
    return _dispatch_template_download(request, 'Staff_Template.xlsx')


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
@throttle_classes([AdminImportThrottle])
@transaction.atomic
def admin_workload_import(request):
    """POST /api/admin/workloads/import/ — MVP row-level validation with capped uploads."""
    try:
        import openpyxl
    except ImportError:
        return Response(
            {'success': False, 'message': 'Import unavailable: openpyxl not installed'},
            status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    uploaded = request.FILES.get('file')
    if not uploaded:
        return Response(
            {'success': False, 'message': 'file field is required'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if uploaded.size > MAX_EXCEL_UPLOAD_BYTES:
        return Response(
            {'success': False, 'message': 'file exceeds maximum allowed size'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    year_raw = request.POST.get('year') or request.POST.get('academic_year')
    semester = (request.POST.get('semester') or '').strip().upper()
    try:
        year_val = int(year_raw)
    except (TypeError, ValueError):
        return Response(
            {'success': False, 'message': 'academic_year and semester are required and must be valid'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    if semester not in dict(WorkloadReport.SEMESTER_CHOICES):
        return Response(
            {'success': False, 'message': 'semester must be S1, S2, or FULL_YEAR'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    workbook = openpyxl.load_workbook(filename=io.BytesIO(uploaded.read()), read_only=True, data_only=True)
    sheet = workbook.active

    rows_iter = sheet.iter_rows(values_only=True)
    header_row = next(rows_iter, None)
    if not header_row:
        return Response({'success': False, 'message': 'empty workbook'}, status=400)

    header_map = {}
    for idx, cell in enumerate(header_row):
        if cell:
            header_map[str(cell).strip().lower()] = idx

    required_cols = {'employee_id', 'total_work_hours'}
    missing = required_cols - set(header_map.keys())
    if missing:
        return Response(
            {'success': False, 'message': 'workbook headers invalid', 'errors': sorted(missing)},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    imported_count = 0
    failures = []

    batch_id = uuid.uuid4()

    def col(row_tuple, header_name):
        idx = header_map.get(header_name)
        if idx is None or idx >= len(row_tuple):
            return ''
        val = row_tuple[idx]
        if val is None:
            return ''
        return str(val).strip()

    for offset, cells in enumerate(rows_iter, start=2):
        employee_id = col(cells, 'employee_id')
        hours_raw = col(cells, 'total_work_hours')
        description = col(cells, 'description')
        # Always force INITIAL — spreadsheet status column must never bypass the approval workflow.
        norm_status = 'INITIAL'

        if not employee_id:
            failures.append({'row': offset, 'field': 'employee_id', 'message': 'employee_id is required'})
            continue

        try:
            hours_val = Decimal(str(hours_raw or '0'))
        except Exception:
            failures.append({'row': offset, 'field': 'total_work_hours', 'message': 'invalid decimal'})
            continue

        if hours_val < 0:
            failures.append({'row': offset, 'field': 'total_work_hours', 'message': 'total_work_hours must be non-negative'})
            continue

        staff_row = Staff.objects.select_related('department', 'user').filter(staff_number=employee_id).first()
        if not staff_row:
            failures.append({'row': offset, 'field': 'employee_id', 'message': 'Employee not found'})
            continue

        conflicts = WorkloadReport.objects.filter(
            staff=staff_row,
            academic_year=year_val,
            semester=semester,
            is_current=True,
        ).exclude(status__in=['INITIAL', 'REJECTED'])
        if conflicts.exists():
            failures.append({'row': offset, 'field': 'status', 'message': 'Report locked; rollback required'})
            continue

        superseded_reports = []
        orphan_reports = WorkloadReport.objects.select_for_update().filter(
            staff=staff_row,
            academic_year=year_val,
            semester=semester,
            is_current=True,
        )
        superseded_reports = list(orphan_reports)

        report = WorkloadReport.objects.create(
            staff=staff_row,
            academic_year=year_val,
            semester=semester,
            snapshot_fte=staff_row.fte,
            snapshot_department=staff_row.department,
            status=norm_status,
            import_batch_id=batch_id,
            is_anomaly=False,
            is_current=True,
        )

        for old in superseded_reports:
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
            changes={'batch': str(batch_id), 'kind': 'ADMIN_WORKLOAD_IMPORT', 'superseded': [str(r.report_id) for r in superseded_reports]},
        )

        WorkloadItem.objects.create(
            report=report,
            category='ASSIGNED_ROLE',
            unit_code=None,
            description=description[:500] if description else 'Imported workload totals',
            allocated_hours=hours_val,
        )
        persist_report_anomaly(report, department_conflict=False)
        imported_count += 1

    return Response({
        'success': True,
        'message': 'Workload import completed',
        'data': {
            'imported_count': imported_count,
            'failed_count': len(failures),
            'errors': failures,
        },
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
@throttle_classes([AdminImportThrottle])
@transaction.atomic
def admin_staff_import(request):
    """POST /api/admin/staff/import/ — updates existing Staff members only (creates no phantom users)."""
    try:
        import openpyxl
    except ImportError:
        return Response(
            {'success': False, 'message': 'Import unavailable: openpyxl not installed'},
            status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    uploaded = request.FILES.get('file')
    if not uploaded:
        return Response({'success': False, 'message': 'file field is required'}, status=http_status.HTTP_400_BAD_REQUEST)

    if uploaded.size > MAX_EXCEL_UPLOAD_BYTES:
        return Response({'success': False, 'message': 'file exceeds maximum allowed size'}, status=http_status.HTTP_400_BAD_REQUEST)

    workbook = openpyxl.load_workbook(filename=io.BytesIO(uploaded.read()), read_only=True, data_only=True)
    sheet = workbook.active

    iterator = sheet.iter_rows(values_only=True)
    header_cells = next(iterator, [])
    mapping = {}
    for idx, value in enumerate(header_cells):
        if value:
            mapping[str(value).strip().lower()] = idx

    required = {'employee_id', 'first_name', 'last_name', 'email', 'department', 'active_status'}
    missing = required - set(mapping.keys())
    if missing:
        return Response({'success': False, 'message': 'staff template malformed', 'errors': sorted(missing)}, status=400)

    successes = []
    failures = []

    def cell(row_vals, header_name):
        idx = mapping[header_name]
        if idx >= len(row_vals):
            return ''
        val = row_vals[idx]
        return '' if val is None else str(val).strip()

    for seq, row_vals in enumerate(iterator, start=2):
        emp_id = cell(row_vals, 'employee_id')
        if not emp_id:
            failures.append({'row': seq, 'field': 'employee_id', 'message': 'employee_id required'})
            continue

        staff_row = Staff.objects.select_related('user', 'department').filter(staff_number=emp_id).first()
        if not staff_row:
            failures.append({'row': seq, 'field': 'employee_id', 'message': 'Employee not found'})
            continue

        dept_name = cell(row_vals, 'department')
        dept = staff_row.department

        if dept_name:
            resolved = Department.objects.filter(name__iexact=dept_name).first()
            if not resolved:
                failures.append({'row': seq, 'field': 'department', 'message': 'Department not found'})
                continue
            dept = resolved

        active_cell = cell(row_vals, 'active_status').lower()
        is_active = active_cell != 'inactive'

        user_obj = staff_row.user
        user_obj.first_name = cell(row_vals, 'first_name') or user_obj.first_name
        user_obj.last_name = cell(row_vals, 'last_name') or user_obj.last_name
        user_obj.email = cell(row_vals, 'email') or user_obj.email
        user_obj.save(update_fields=['first_name', 'last_name', 'email'])

        staff_row.department = dept
        staff_row.is_active = is_active
        staff_row.save(update_fields=['department', 'is_active', 'updated_at'])
        successes.append(emp_id)

    return Response({
        'success': True,
        'message': 'Staff import processed',
        'data': {'imported_count': len(successes), 'failed_count': len(failures), 'errors': failures},
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
def admin_staff_list(request):
    queryset = Staff.objects.select_related('user', 'department').order_by('staff_number')

    dept_filter = request.GET.get('department', '').strip()
    if dept_filter and dept_filter.lower() not in {'all departments', 'all'}:
        queryset = queryset.filter(department__name__iexact=dept_filter)

    search_term = request.GET.get('query', '').strip()
    if search_term:
        queryset = queryset.filter(
            models.Q(user__first_name__icontains=search_term)
            | models.Q(user__last_name__icontains=search_term)
            | models.Q(staff_number__icontains=search_term)
        )

    try:
        page = max(1, int(request.GET.get('page', 1)))
        page_size = max(1, min(100, int(request.GET.get('page_size', 25))))
    except (ValueError, TypeError):
        return Response({'success': False, 'message': 'invalid pagination'}, status=400)

    paginator = Paginator(queryset, page_size)
    page_obj = paginator.get_page(page)

    return Response({
        'success': True,
        'message': 'Staff roster loaded',
        'data': {
            'total': paginator.count,
            'page': page_obj.number,
            'page_size': page_size,
            'items': [_serialize_staff_row(s) for s in page_obj.object_list],
        },
    })


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
@transaction.atomic
def admin_staff_patch(request, staff_id):
    """PATCH /api/admin/staff/{staff_id}/"""
    payload = request.data or {}
    staff_row = _staff_from_body_or_path(request, staff_id)

    first_name = payload.get('first_name')
    last_name = payload.get('last_name')
    email = payload.get('email')
    dept_name = payload.get('department')
    active_state = payload.get('active_status')

    user_obj = staff_row.user
    updated_fields_user = []

    if first_name is not None:
        user_obj.first_name = str(first_name).strip()[:150]
        updated_fields_user.append('first_name')
    if last_name is not None:
        user_obj.last_name = str(last_name).strip()[:150]
        updated_fields_user.append('last_name')
    if email is not None:
        email_clean = str(email).strip().lower()
        email_pattern = r'^[^@\s]+@[^@\s]+\.[^@\s]+$'
        if not re.match(email_pattern, email_clean):
            return Response({'success': False, 'message': 'invalid email'}, status=http_status.HTTP_400_BAD_REQUEST)
        user_obj.email = email_clean
        updated_fields_user.append('email')

    if updated_fields_user:
        user_obj.save(update_fields=list(set(updated_fields_user)))

    staff_update_fields = []
    if dept_name:
        department = Department.objects.filter(name__iexact=str(dept_name).strip()).first()
        if not department:
            return Response({'success': False, 'message': 'department not found'}, status=http_status.HTTP_400_BAD_REQUEST)
        staff_row.department = department
        staff_update_fields.append('department')

    if active_state is not None:
        lowered = str(active_state).strip().lower()
        if lowered not in {'active', 'inactive'}:
            return Response({'success': False, 'message': 'active_status invalid'}, status=http_status.HTTP_400_BAD_REQUEST)
        staff_row.is_active = lowered != 'inactive'
        staff_update_fields.append('is_active')

    if staff_update_fields:
        staff_update_fields.append('updated_at')
        staff_row.save(update_fields=staff_update_fields)

    return Response({
        'success': True,
        'message': 'Staff profile updated',
        'data': _serialize_staff_row(staff_row),
    })


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
def admin_role_assignments(request):
    """GET list + POST create."""
    if request.method == 'GET':
        queryset = StaffRoleAssignment.objects.select_related('staff', 'resolved_department').order_by('-created_at')
        return Response({'success': True, 'message': 'Assignments loaded', 'data': {
            'items': [_serialize_assignment_row(obj) for obj in queryset[:500]],
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

    resolved = Department.objects.filter(name__iexact=dept_scope).first()

    assignment = StaffRoleAssignment.objects.create(
        staff=staff_row,
        role_code=role_front,
        department_scope=dept_scope,
        resolved_department=resolved,
        permissions=permissions,
        status='active',
    )

    # Sync Staff.role so require_role() checks take effect immediately.
    _FRONT_TO_CANONICAL = {'HoD': 'HOD', 'Admin': 'SCHOOL_OPS'}
    canonical = _FRONT_TO_CANONICAL.get(role_front)
    if canonical:
        staff_row.role = canonical
        staff_row.save(update_fields=['role', 'updated_at'])

    return Response({
        'success': True,
        'message': 'Role assigned',
        'data': {
            **_serialize_assignment_row(assignment),
        },
    }, status=http_status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
@transaction.atomic
def admin_role_assignment_disable(request, assignment_id):
    payload = request.data or {}
    reason = str(payload.get('reason') or '').strip()

    assignment = get_object_or_404(StaffRoleAssignment, assignment_id=int(assignment_id))
    assignment.status = 'disabled'
    assignment.disable_reason = reason[:500]
    assignment.save(update_fields=['status', 'disable_reason', 'updated_at'])

    return Response({'success': True, 'message': 'Role assignment disabled', 'data': {
        'id': assignment.assignment_id,
        'status': assignment.status,
    }})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
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
        hours_total = sum((i.allocated_hours for i in report.items.all()), Decimal('0.00'))

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
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
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
@permission_classes([IsAuthenticated])
@require_role(*ADMIN_ROLES)
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
