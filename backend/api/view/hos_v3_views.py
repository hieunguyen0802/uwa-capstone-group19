"""
HoS API (v3) — frontend contract `IntegrationLog/hod-hos-frontend-api.zh-en(1).md` §6.

Scope: workload approval plus P1/P2 reports, staff directory, role assignments,
analytics, and export.

Legacy `/api/headofschool/*` endpoints stay live during cutover.
"""

from decimal import Decimal
from urllib.parse import urlencode

from django.contrib.auth.models import User
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.models import AuditLog, Department, Staff, StaffRoleAssignment, WorkloadItem, WorkloadReport
from api.permissions import IsHoSOrSchoolOps
from api.services.workload_service import _filter_reports_by_range, _parse_year_range, stale_report_response_payload
from api.view.hos_views import (
    ALLOWED_STAFF_DEPARTMENTS,
    _is_valid_staff_number,
    _read_staff_import_rows,
)
from api.view.hod_views import (
    _first,
    _analytics_payload,
    _filter_period_params,
    _get_workload_request_meta_map,
    _parse_period_report_id,
    _parse_breakdown,
    _report_period_id,
    _serialize_detail,
    _serialize_row,
    _semester_report_rows,
    _status_summary,
    _workbook_response,
)


def _hos_visible_qs():
    """
    HoS queue visibility: school-wide (no department filter).

    Same status gate as HoD (INITIAL only when confirmed), but starts from the
    full WorkloadReport set rather than the caller's department scope.
    """
    hod_self_subq = AuditLog.objects.filter(
        report=OuterRef('pk'),
        changes__kind='HOD_SELF_WORKLOAD_REQUEST',
    )
    return (
        WorkloadReport.objects.filter(is_current=True)
        .select_related('staff__user', 'staff__department', 'snapshot_department')
        .annotate(is_hod_self_submission=Exists(hod_self_subq))
        .filter(
            Q(status__in=['PENDING', 'APPROVED', 'REJECTED'])
            | Q(status='INITIAL', confirmation_status='CONFIRMED')
        )
    )


ROLE_DEFAULT_PERMISSIONS = {
    'HoD': ['View Workload', 'Approve Workload', 'Update Workload'],
    'Admin': ['Distribute Workload to Departments', 'Edit Employee Information'],
}
ROLE_TO_CANONICAL = {'HoD': 'HOD', 'Admin': 'SCHOOL_OPS'}
SUPERSEDED_ROLE_REASON = 'Superseded by a newer role assignment.'


def _serialize_staff_directory_row(staff):
    return {
        'id': str(staff.staff_id),
        'staffId': staff.staff_number,
        'firstName': staff.user.first_name,
        'lastName': staff.user.last_name,
        'email': staff.user.email,
        'title': staff.title or '',
        'currentDepartment': staff.department.name,
        'isActive': bool(staff.is_active),
        'isNewEmployee': False,
        'notes': '',
    }


def _serialize_assignment(assignment):
    staff = assignment.staff
    user = staff.user
    full_name = user.get_full_name().strip() or user.username
    return {
        'id': assignment.assignment_id,
        'staffId': staff.staff_number,
        'name': full_name,
        'role': assignment.role_code,
        'department': assignment.department_scope,
        'permissions': assignment.permissions or [],
        'assignedAt': assignment.created_at.isoformat() if assignment.created_at else None,
        'status': assignment.status,
    }


def _current_assignment_queryset(include_disabled=False):
    queryset = StaffRoleAssignment.objects.select_related('staff__user').order_by('-created_at', '-assignment_id')
    if include_disabled:
        return queryset
    return queryset.filter(status='active')


def _dedupe_latest_by_staff(assignments):
    latest_by_staff = {}
    for assignment in assignments:
        if assignment.staff_id in latest_by_staff:
            continue
        latest_by_staff[assignment.staff_id] = assignment
    return list(latest_by_staff.values())


def _row_value(row, *keys, default=''):
    for key in keys:
        if key in row and row[key] not in (None, ''):
            return row[key]
    lower_map = {str(k).strip().lower(): v for k, v in row.items()}
    for key in keys:
        value = lower_map.get(str(key).strip().lower())
        if value not in (None, ''):
            return value
    return default


def _parse_staff_active_status(value):
    if value in (None, ''):
        return True, None
    if isinstance(value, bool):
        return value, None

    normalized = str(value).strip().lower()
    if not normalized:
        return True, None
    if normalized in ('active', 'true', '1', 'yes', 'y'):
        return True, None
    if normalized in ('inactive', 'false', '0', 'no', 'n'):
        return False, None
    return True, 'active_status must be Active or Inactive'


def _normalize_staff_import_row(row, row_number):
    staff_id = str(_row_value(row, 'staffId', 'staff_id', 'Staff ID', 'Staff Number')).strip()
    first_name = str(_row_value(row, 'firstName', 'first_name', 'First Name')).strip()
    last_name = str(_row_value(row, 'lastName', 'last_name', 'Last Name')).strip()
    email = str(_row_value(row, 'email', 'Email')).strip()
    title = str(_row_value(row, 'title', 'Title')).strip()
    department = str(_row_value(row, 'department', 'Department')).strip() or 'Computer Science & Software Engineering'
    active_raw = _row_value(row, 'isActive', 'active_status', 'Active Status', default='Active')
    is_active, active_message = _parse_staff_active_status(active_raw)
    is_new_raw = _row_value(row, 'isNewEmployee', 'is_new_employee', 'new_employee', 'New Employee', default='')
    is_new_employee = (
        is_new_raw if isinstance(is_new_raw, bool)
        else str(is_new_raw).strip().lower() in ('true', '1', 'yes', 'y')
    )
    notes = str(_row_value(row, 'notes', 'Notes')).strip()
    messages = []
    if not staff_id:
        messages.append('staff_id is required')
    elif not _is_valid_staff_number(staff_id):
        messages.append('staff_id must be exactly 8 characters')
    if not first_name:
        messages.append('first_name is required')
    if not last_name:
        messages.append('last_name is required')
    if not email:
        messages.append('email is required')
    elif '@' not in email:
        messages.append('email must contain @')
    if department not in ALLOWED_STAFF_DEPARTMENTS:
        messages.append('department is not in allowed values')
    if active_message:
        messages.append(active_message)

    return {
        'rowNumber': row_number,
        'staffId': staff_id,
        'firstName': first_name,
        'lastName': last_name,
        'email': email,
        'title': title,
        'department': department,
        'isActive': bool(is_active),
        'isNewEmployee': bool(is_new_employee),
        'notes': notes,
        'messages': messages,
        'valid': not messages,
    }


# ─── GET /api/hos/workload-requests/ ────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
def hos_workload_requests(request):
    base_qs = _hos_visible_qs()
    qs = base_qs.prefetch_related('items')

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

    department = (request.GET.get('department') or '').strip()
    if department and department != 'All Departments':
        qs = qs.filter(snapshot_department__name=department)

    year = (request.GET.get('year') or '').strip()
    if year:
        try:
            qs = qs.filter(academic_year=int(year))
        except ValueError:
            pass

    semester = (request.GET.get('semester') or '').strip()
    if semester:
        qs = qs.filter(semester=semester.upper())

    qs = qs.order_by('-is_hod_self_submission', '-updated_at')

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


# ─── GET /api/hos/workload-requests/{id}/ ───────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
def hos_workload_request_detail(request, id):
    qs = _hos_visible_qs().prefetch_related('items')
    report = get_object_or_404(qs, report_id=id)
    return Response(_serialize_detail(report))


# ─── POST /api/hos/workload-requests/{id}/decision/ ─────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
@transaction.atomic
def hos_workload_request_decision(request, id):
    """
    See hod_views.hod_workload_request_decision — contract is identical except
    for the reviewing role. ifVersion is accepted but not enforced yet.
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

    qs = _hos_visible_qs()
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

    audit_changes = {'kind': 'HOS_DECISION', 'decision': decision}
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


# ─── GET /api/hos/reports/semester-distribution ────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
def hos_semester_distribution_reports(request):
    department = (request.GET.get('department') or '').strip()
    qs = _filter_period_params(
        _hos_visible_qs()
        .select_related('snapshot_department')
        .prefetch_related('items'),
        request,
    )
    if department and department != 'All Departments':
        qs = qs.filter(snapshot_department__name=department)

    period_rows = {}
    for (year, semester, _department), updated_at in _semester_report_rows(qs).items():
        key = (year, semester)
        current = period_rows.get(key)
        if current is None or updated_at > current:
            period_rows[key] = updated_at

    items = []
    for (year, semester), updated_at in sorted(period_rows.items()):
        report_id = _report_period_id('hos-report', year, semester)
        download_url = f'/api/hos/reports/semester-distribution/{report_id}/download'
        if department and department != 'All Departments':
            download_url += f'?{urlencode({"department": department})}'
        items.append({
            'id': report_id,
            'year': year,
            'semester': semester,
            'title': f'{year} {semester} distribution report generated',
            'createdAt': updated_at.isoformat() if updated_at else None,
            'downloadUrl': download_url,
            'unread': True,
        })
    return Response({'items': items})


# ─── GET /api/hos/reports/semester-distribution/{reportId}/download ────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
def hos_semester_distribution_report_download(request, report_id):
    year, semester = _parse_period_report_id(report_id, 'hos-report')
    if year is None or semester is None:
        return Response(
            {'success': False, 'message': 'Invalid report id'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    qs = (
        _hos_visible_qs()
        .filter(academic_year=year, semester=semester)
        .select_related('staff__user', 'snapshot_department')
        .prefetch_related('items')
        .order_by('snapshot_department__name', 'staff__staff_number')
    )
    department = (request.GET.get('department') or '').strip()
    if department and department != 'All Departments':
        qs = qs.filter(snapshot_department__name=department)
    return _workbook_response('HoS Distribution', f'HoS_{year}_{semester}_Distribution.xlsx', list(qs))


# ─── GET /api/hos/staff-directory ──────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
def hos_staff_directory(request):
    qs = (
        Staff.objects.select_related('user', 'department')
        .exclude(pk=request.staff.pk)
        .exclude(role='HOS')
        .order_by('staff_number')
    )

    first_name = (request.GET.get('firstName') or request.GET.get('first_name') or '').strip()
    if first_name:
        qs = qs.filter(user__first_name__icontains=first_name)
    last_name = (request.GET.get('lastName') or request.GET.get('last_name') or '').strip()
    if last_name:
        qs = qs.filter(user__last_name__icontains=last_name)
    staff_id = (request.GET.get('staffId') or request.GET.get('staff_id') or '').strip()
    if staff_id:
        qs = qs.filter(staff_number__icontains=staff_id)
    is_active = request.GET.get('isActive')
    if is_active is not None and str(is_active).strip() != '':
        qs = qs.filter(is_active=str(is_active).strip().lower() in ('true', '1', 'yes', 'active'))

    try:
        page = max(1, int(request.GET.get('page', 1)))
        page_size = max(1, min(100, int(request.GET.get('pageSize') or request.GET.get('page_size') or 20)))
    except (TypeError, ValueError):
        return Response(
            {'success': False, 'message': 'page and pageSize must be positive integers'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    paginator = Paginator(qs, page_size)
    current = paginator.get_page(page)
    rows = [_serialize_staff_directory_row(staff) for staff in current.object_list]
    return Response({
        'items': rows,
        'page': current.number,
        'pageSize': page_size,
        'total': paginator.count,
    })


# ─── POST /api/hos/staff-directory/import ─────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
@transaction.atomic
def hos_staff_directory_import(request):
    upload_file = request.FILES.get('file')
    if not upload_file:
        return Response(
            {'success': False, 'message': 'Validation failed', 'errors': {'file': ['file is required']}},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    rows, error = _read_staff_import_rows(upload_file)
    if error:
        return Response({'success': False, 'message': error}, status=http_status.HTTP_400_BAD_REQUEST)

    parsed_rows = [_normalize_staff_import_row(row, idx) for idx, row in enumerate(rows, start=2)]
    if not parsed_rows:
        return Response(
            {
                'success': False,
                'message': 'No staff rows found in the uploaded file.',
                'importedCount': 0,
                'failedCount': 0,
                'items': [],
            },
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    invalid_rows = [row for row in parsed_rows if not row['valid']]
    if invalid_rows:
        for parsed in parsed_rows:
            parsed['imported'] = False
        return Response(
            {
                'success': False,
                'message': 'Staff import validation failed. No records were saved.',
                'importedCount': 0,
                'failedCount': len(invalid_rows),
                'items': parsed_rows,
            },
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    imported_count = 0

    for parsed in parsed_rows:
        department, _ = Department.objects.get_or_create(name=parsed['department'])
        existing_staff = Staff.objects.select_related('user').filter(staff_number=parsed['staffId']).first()
        user = existing_staff.user if existing_staff else None
        created_user = False
        if user is None:
            user, created_user = User.objects.get_or_create(
                username=parsed['staffId'],
                defaults={
                    'first_name': parsed['firstName'],
                    'last_name': parsed['lastName'],
                    'email': parsed['email'],
                },
            )
        if created_user:
            user.set_unusable_password()
            user.save()
        else:
            user.first_name = parsed['firstName']
            user.last_name = parsed['lastName']
            user.email = parsed['email']
            user.save(update_fields=['first_name', 'last_name', 'email'])

        if existing_staff is None:
            Staff.objects.create(
                staff_number=parsed['staffId'],
                user=user,
                role='ACADEMIC',
                department=department,
                is_active=parsed['isActive'],
                title=parsed['title'],
            )
        else:
            staff = existing_staff
            staff.user = user
            staff.department = department
            staff.is_active = parsed['isActive']
            staff.title = parsed['title']
            staff.save(update_fields=[
                'user',
                'department',
                'is_active',
                'title',
                'updated_at',
            ])
        parsed['imported'] = True
        imported_count += 1

    for parsed in parsed_rows:
        parsed.setdefault('imported', False)

    failed_count = len(parsed_rows) - imported_count
    return Response({
        'success': failed_count == 0,
        'message': 'Staff import parsed',
        'importedCount': imported_count,
        'failedCount': failed_count,
        'items': parsed_rows,
    })


# ─── GET/POST /api/hos/role-assignments ────────────────────────────────────

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
@transaction.atomic
def hos_v3_role_assignments(request):
    if request.method == 'GET':
        include_disabled = str(request.GET.get('includeDisabled') or '').strip().lower() in ('1', 'true', 'yes')
        queryset = _current_assignment_queryset(include_disabled=include_disabled)
        assignments = list(queryset[:500])
        if not include_disabled:
            assignments = _dedupe_latest_by_staff(assignments)
        return Response({'items': [_serialize_assignment(obj) for obj in assignments]})

    payload = request.data or {}
    staff_id = str(payload.get('staffId') or payload.get('staff_id') or '').strip()
    role = str(payload.get('role') or '').strip()
    department_name = str(payload.get('department') or '').strip()
    permissions = payload.get('permissions') or ROLE_DEFAULT_PERMISSIONS.get(role, [])

    if not staff_id or role not in ROLE_TO_CANONICAL:
        return Response(
            {'success': False, 'message': 'staffId and role=HoD|Admin are required'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )
    if not isinstance(permissions, list):
        return Response(
            {'success': False, 'message': 'permissions must be a list'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    staff = get_object_or_404(Staff.objects.select_related('user', 'department'), staff_number=staff_id)
    if role == 'Admin':
        resolved = None
    else:
        resolved = Department.objects.filter(name__iexact=department_name).first()
        if department_name and resolved is None:
            resolved = Department.objects.create(name=department_name)

    StaffRoleAssignment.objects.filter(staff=staff, status='active').update(
        status='disabled',
        disable_reason=SUPERSEDED_ROLE_REASON,
        updated_at=timezone.now(),
    )

    assignment = StaffRoleAssignment.objects.create(
        staff=staff,
        role_code=role,
        department_scope=department_name or (staff.department.name if staff.department_id else ''),
        resolved_department=resolved,
        permissions=permissions,
        status='active',
    )

    if resolved is not None:
        staff.department = resolved
    staff.role = ROLE_TO_CANONICAL[role]
    staff.save(update_fields=['role', 'department', 'updated_at'])

    return Response(_serialize_assignment(assignment), status=http_status.HTTP_201_CREATED)


# ─── PATCH /api/hos/role-assignments/{assignmentId}/status ─────────────────

@api_view(['PATCH'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
@transaction.atomic
def hos_v3_role_assignment_status(request, assignment_id):
    desired = str((request.data or {}).get('status') or '').strip().lower()
    if desired != 'disabled':
        return Response(
            {'success': False, 'message': 'status must be disabled'},
            status=http_status.HTTP_400_BAD_REQUEST,
        )

    assignment = get_object_or_404(StaffRoleAssignment, assignment_id=int(assignment_id))
    assignment.status = 'disabled'
    assignment.disable_reason = str((request.data or {}).get('reason') or '')[:500]
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
        assignment.staff.role = ROLE_TO_CANONICAL[latest_active.role_code]
        if latest_active.resolved_department_id is not None:
            assignment.staff.department = latest_active.resolved_department
            assignment.staff.save(update_fields=['role', 'department', 'updated_at'])
        else:
            assignment.staff.save(update_fields=['role', 'updated_at'])

    return Response({'id': assignment.assignment_id, 'status': assignment.status})


# ─── GET /api/hos/analytics/workloads ──────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
def hos_workload_analytics(request):
    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')
    department = (request.GET.get('department') or 'All Departments').strip()

    qs = (
        _hos_visible_qs()
        .select_related('staff__user', 'snapshot_department')
        .prefetch_related('items')
    )
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter)
    if department and department != 'All Departments':
        qs = qs.filter(snapshot_department__name=department)
    qs = qs.order_by('academic_year', 'semester', 'snapshot_department__name')

    payload = _analytics_payload(qs, year_from, year_to, semester_filter, department or 'All Departments')
    payload['summary']['totalDepartments'] = len({row['department'] for row in payload['workloadHoursDistribution']})
    return Response({'success': True, 'message': 'HoS analytics loaded', 'data': payload})


# ─── GET /api/hos/exports/workloads ────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsHoSOrSchoolOps])
def hos_workload_export(request):
    year_from, year_to = _parse_year_range(request)
    semester_filter = request.GET.get('semester', 'All')
    department = (request.GET.get('department') or 'All Departments').strip()
    qs = (
        _hos_visible_qs()
        .select_related('staff__user', 'snapshot_department')
        .prefetch_related('items')
        .order_by('snapshot_department__name', 'staff__staff_number', 'academic_year', 'semester')
    )
    qs = _filter_reports_by_range(qs, year_from, year_to, semester_filter)
    if department and department != 'All Departments':
        qs = qs.filter(snapshot_department__name=department)
    return _workbook_response('HoS Workloads', 'HoS_Workloads.xlsx', list(qs))
