from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.db import transaction
from ..models import Staff, WorkloadReport, AuditLog

MANAGER_ROLES = {'HOD', 'SCHOOL_OPS', 'HOS'}


def _require_manager(request):
    staff = get_object_or_404(Staff, user=request.user)
    if staff.role not in MANAGER_ROLES:
        return Response({"error": "Forbidden"}, status=403)
    return None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def supervisor_requests(request):
    """Return all workload reports grouped by status."""
    forbidden = _require_manager(request)
    if forbidden:
        return forbidden

    qs = WorkloadReport.objects.filter(is_current=True).select_related('staff__user').order_by('-created_at')

    def serialize(reports):
        return [
            {
                "report_id": str(r.report_id),
                "staff_number": r.staff.staff_number,
                "academic_year": r.academic_year,
                "semester": r.semester,
                "status": r.status,
                "is_anomaly": r.is_anomaly,
                "created_at": r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else None,
            }
            for r in reports
        ]

    return Response({
        "pending": serialize(qs.filter(status='PENDING')),
        "approved": serialize(qs.filter(status='APPROVED')),
        "history": serialize(qs.exclude(status='PENDING')),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@transaction.atomic
def approve_request(request, id):
    """Approve a workload report by its UUID."""
    forbidden = _require_manager(request)
    if forbidden:
        return forbidden

    staff = get_object_or_404(Staff, user=request.user)
    report = get_object_or_404(WorkloadReport, report_id=id, is_current=True)

    report.status = 'APPROVED'
    report.save()

    AuditLog.objects.create(report=report, action_by=staff, action_type='APPROVE')
    return Response({"message": "Approved"})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@transaction.atomic
def reject_request(request, id):
    """Reject a workload report by its UUID."""
    forbidden = _require_manager(request)
    if forbidden:
        return forbidden

    staff = get_object_or_404(Staff, user=request.user)
    report = get_object_or_404(WorkloadReport, report_id=id, is_current=True)
    comment = request.data.get('comment', '')

    report.status = 'REJECTED'
    report.save()

    AuditLog.objects.create(report=report, action_by=staff, action_type='REJECT', comment=comment or None)
    return Response({"message": "Rejected"})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_my_workloads(request):
    """Return the 20 most recent workload reports."""
    forbidden = _require_manager(request)
    if forbidden:
        return forbidden

    reports = WorkloadReport.objects.filter(is_current=True).select_related('staff').order_by('-created_at')[:20]
    data = [
        {
            "report_id": str(r.report_id),
            "staff_number": r.staff.staff_number,
            "academic_year": r.academic_year,
            "semester": r.semester,
            "status": r.status,
            "is_anomaly": r.is_anomaly,
        }
        for r in reports
    ]
    return Response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_pending_requests(request):
    """Return all PENDING workload reports."""
    forbidden = _require_manager(request)
    if forbidden:
        return forbidden

    reports = WorkloadReport.objects.filter(
        status='PENDING', is_current=True
    ).select_related('staff__user').order_by('-created_at')

    data = [
        {
            "report_id": str(r.report_id),
            "staff_number": r.staff.staff_number,
            "academic_year": r.academic_year,
            "semester": r.semester,
            "is_anomaly": r.is_anomaly,
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M"),
        }
        for r in reports
    ]
    return Response(data)
