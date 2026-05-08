"""
HoS API (v3) — frontend contract `IntegrationLog/hod-hos-frontend-api.zh-en(1).md` §6.

Scope in this PR: list / detail / decision only, with explicit school-wide
visibility (department filter only when caller provides it).

Legacy `/api/headofschool/*` endpoints stay live during cutover.
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
from api.services.workload_service import stale_report_response_payload
from api.view.hod_views import (
    _first,
    _parse_breakdown,
    _serialize_detail,
    _serialize_row,
)


def _hos_visible_qs():
    """
    HoS queue visibility: school-wide (no department filter).

    Same status gate as HoD (INITIAL only when confirmed), but starts from the
    full WorkloadReport set rather than the caller's department scope.
    """
    confirmed_subq = AuditLog.objects.filter(
        report=OuterRef('pk'),
        changes__kind='CONFIRMATION',
        changes__confirmation='confirmed',
    )
    return (
        WorkloadReport.objects.filter(is_current=True)
        .select_related('staff__user', 'staff__department', 'snapshot_department')
        .annotate(is_confirmed=Exists(confirmed_subq))
        .filter(
            Q(status__in=['PENDING', 'APPROVED', 'REJECTED'])
            | Q(status='INITIAL', is_confirmed=True)
        )
    )


# ─── GET /api/hos/workload-requests/ ────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOS', 'SCHOOL_OPS')
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


# ─── GET /api/hos/workload-requests/{id}/ ───────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOS', 'SCHOOL_OPS')
def hos_workload_request_detail(request, id):
    qs = _hos_visible_qs().prefetch_related('items')
    report = get_object_or_404(qs, report_id=id)
    return Response(_serialize_detail(report))


# ─── POST /api/hos/workload-requests/{id}/decision/ ─────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOS', 'SCHOOL_OPS')
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
