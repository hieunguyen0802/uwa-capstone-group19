from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404
from django.db import transaction
from api.models import WorkloadReport, AuditLog
from api.decorators import require_role


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def get_my_workloads(request):
    """Return workload reports for the currently authenticated academic."""
    reports = WorkloadReport.objects.filter(
        staff=request.staff, is_current=True
    ).order_by('-created_at').values(
        'report_id', 'academic_year', 'semester', 'status', 'is_anomaly', 'created_at'
    )
    return Response(list(reports))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
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
            {"code": "VALIDATION_ERROR", "message": "report_id and action are required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if action not in ['approve', 'reject']:
        return Response(
            {"code": "VALIDATION_ERROR", "message": "action must be 'approve' or 'reject'"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if action == 'reject' and not comment:
        return Response(
            {"code": "VALIDATION_ERROR", "message": "comment is required when rejecting"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # filter by staff=request.staff ensures academic can only act on their own reports
    report = get_object_or_404(WorkloadReport, report_id=report_id, staff=request.staff, is_current=True)

    if report.status != 'PENDING':
        return Response(
            {"code": "CONFLICT", "message": f"This report is already '{report.status}', cannot submit again"},
            status=status.HTTP_409_CONFLICT
        )

    report.status = 'APPROVED' if action == 'approve' else 'REJECTED'
    report.save()

    AuditLog.objects.create(
        report=report,
        action_by=request.staff,
        action_type='APPROVE' if action == 'approve' else 'REJECT',
        comment=comment or None,
    )

    return Response({
        "message": f"Report {action}d successfully",
        "report_id": str(report.report_id)
    }, status=status.HTTP_200_OK)
