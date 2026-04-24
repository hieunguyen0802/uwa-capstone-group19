from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import transaction
from django.shortcuts import get_object_or_404
from api.models import WorkloadReport, AuditLog
from api.decorators import require_role
from api.services.workload_service import get_workload_queryset


def _serialize_query(report):
    # Attach the Academic's original comment to the response so HOD has context
    comment_log = (
        AuditLog.objects.filter(report=report, action_type='COMMENT')
        .order_by('created_at')
        .first()
    )
    return {
        "report_id": str(report.report_id),
        "staff_number": report.staff.staff_number,
        "academic_year": report.academic_year,
        "semester": report.semester,
        "is_anomaly": report.is_anomaly,
        "query_comment": comment_log.comment if comment_log else None,
        "query_submitted_at": (
            comment_log.created_at.strftime("%Y-%m-%d %H:%M") if comment_log else None
        ),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'HOS', 'SCHOOL_OPS')
def get_pending_queries(request):
    """
    GET /api/queries/pending/
    Returns PENDING reports where the Academic has submitted a query (COMMENT log exists).
    HOD sees only their department; HOS and SCHOOL_OPS see all.
    """
    queried_report_ids = AuditLog.objects.filter(
        action_type='COMMENT'
    ).values_list('report_id', flat=True)

    qs = (
        get_workload_queryset(request.staff)
        .filter(status='PENDING', report_id__in=queried_report_ids)
        .select_related('staff')
        .order_by('-created_at')
    )
    return Response([_serialize_query(r) for r in qs])


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'HOS', 'SCHOOL_OPS')
@transaction.atomic
def approve_query(request, id):
    """
    POST /api/queries/<id>/approve/
    Approves the Academic's query. Report status transitions PENDING → APPROVED.
    Body: { "reason": "<string>" }  (optional)
    Errors: 404 if not in scope, 409 if already actioned.
    """
    qs = get_workload_queryset(request.staff)
    report = get_object_or_404(qs, report_id=id)

    if report.status != 'PENDING':
        return Response(
            {"code": "CONFLICT", "message": f"Report is already '{report.status}'."},
            status=409,
        )

    reason = (request.data.get('reason') or '').strip() or None
    report.status = 'APPROVED'
    report.save()
    AuditLog.objects.create(
        report=report,
        action_by=request.staff,
        action_type='APPROVE',
        comment=reason,
    )
    return Response({"report_id": str(report.report_id), "status": "APPROVED"})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'HOS', 'SCHOOL_OPS')
@transaction.atomic
def reject_query(request, id):
    """
    POST /api/queries/<id>/reject/
    Rejects the Academic's query. Reason is mandatory. Status transitions PENDING → REJECTED.
    Body: { "reason": "<string>" }  (required)
    Errors: 404 if not in scope, 409 if already actioned, 422 if reason missing.
    """
    reason = (request.data.get('reason') or '').strip()
    if not reason:
        return Response(
            {"code": "VALIDATION_ERROR", "message": "reason is required when rejecting."},
            status=422,
        )

    qs = get_workload_queryset(request.staff)
    report = get_object_or_404(qs, report_id=id)

    if report.status != 'PENDING':
        return Response(
            {"code": "CONFLICT", "message": f"Report is already '{report.status}'."},
            status=409,
        )

    report.status = 'REJECTED'
    report.save()
    AuditLog.objects.create(
        report=report,
        action_by=request.staff,
        action_type='REJECT',
        comment=reason,
    )
    return Response({"report_id": str(report.report_id), "status": "REJECTED"})
