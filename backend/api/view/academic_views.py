from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404
from django.db import transaction
from api.models import Staff, WorkloadReport, AuditLog


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_my_workloads(request):
    """Return workload reports for the currently authenticated academic."""
    staff = get_object_or_404(Staff, user=request.user)
    reports = WorkloadReport.objects.filter(
        staff=staff, is_current=True
    ).order_by('-created_at').values(
        'report_id', 'academic_year', 'semester', 'status', 'is_anomaly', 'created_at'
    )
    return Response(list(reports))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@transaction.atomic
def submit_request(request):
    """
    Academic submits an approve or reject decision on a workload report.

    Required body fields:
      - report_id (str): UUID of the WorkloadReport
      - action    (str): 'approve' | 'reject'
      - comment   (str): mandatory when action == 'reject'
    """
    report_id = request.data.get('report_id')
    action = request.data.get('action')
    comment = request.data.get('comment', '')

    if not report_id or not action:
        return Response(
            {"error": "report_id and action are required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if action not in ['approve', 'reject']:
        return Response(
            {"error": "action must be 'approve' or 'reject'"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if action == 'reject' and not comment:
        return Response(
            {"error": "comment is required when rejecting"},
            status=status.HTTP_400_BAD_REQUEST
        )

    staff = get_object_or_404(Staff, user=request.user)
    report = get_object_or_404(WorkloadReport, report_id=report_id, staff=staff, is_current=True)

    if report.status != 'PENDING':
        return Response(
            {"error": f"This report is already '{report.status}', cannot submit again"},
            status=status.HTTP_400_BAD_REQUEST
        )

    action_type = 'APPROVE' if action == 'approve' else 'REJECT'
    report.status = 'APPROVED' if action == 'approve' else 'REJECTED'
    report.save()

    AuditLog.objects.create(
        report=report,
        action_by=staff,
        action_type=action_type,
        comment=comment or None,
    )

    return Response({
        "message": f"Report {action}d successfully",
        "report_id": str(report.report_id)
    }, status=status.HTTP_200_OK)
