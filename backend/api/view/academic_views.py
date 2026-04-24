from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404
from django.db import transaction
from api.models import WorkloadReport, AuditLog
from api.decorators import require_role
from api.services.workload_service import get_workload_queryset


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def get_my_workloads(request):
    """
    GET /api/workloads/my/
    Returns all current workload reports for the authenticated academic.
    Response includes is_anomaly so the frontend can highlight flagged rows.
    """
    qs = get_workload_queryset(request.staff).order_by('-created_at')
    data = [
        {
            "report_id": str(r.report_id),
            "academic_year": r.academic_year,
            "semester": r.semester,
            "status": r.status,
            "is_anomaly": r.is_anomaly,
            "snapshot_fte": str(r.snapshot_fte),
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M"),
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
            {"code": "VALIDATION_ERROR", "message": "workload_report_id and comment are required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Scoped queryset ensures academic can only query their own reports
    qs = get_workload_queryset(request.staff)
    report = get_object_or_404(qs, report_id=report_id)

    # Prevent duplicate queries on the same report
    already_queried = AuditLog.objects.filter(
        report=report, action_type='COMMENT'
    ).exists()
    if already_queried:
        return Response(
            {"code": "CONFLICT", "message": "A query has already been submitted for this report."},
            status=status.HTTP_409_CONFLICT
        )

    AuditLog.objects.create(
        report=report,
        action_by=request.staff,
        action_type='COMMENT',
        comment=comment,
    )

    return Response(
        {"report_id": str(report.report_id), "status": report.status},
        status=status.HTTP_201_CREATED
    )
