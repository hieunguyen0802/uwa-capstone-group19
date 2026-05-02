from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import transaction
from django.shortcuts import get_object_or_404
from api.models import WorkloadReport, AuditLog
from api.decorators import require_role
from api.services.workload_service import get_workload_queryset


def _serialize_report(r):
    return {
        "report_id": str(r.report_id),
        "staff_number": r.staff.staff_number,
        "academic_year": r.academic_year,
        "semester": r.semester,
        "status": r.status,
        "is_anomaly": r.is_anomaly,
        "created_at": r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else None,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def supervisor_requests(request):
    """Return workload reports grouped by status, scoped to the caller's role."""
    qs = get_workload_queryset(request.staff).order_by('-created_at')

    # Only surface PENDING reports that the academic has explicitly submitted.
    # Reports that are still PENDING but have no WORKLOAD_REQUEST log are not
    # yet visible to HOD — the academic hasn't acted on them yet.
    submitted_ids = AuditLog.objects.filter(
        changes__kind='WORKLOAD_REQUEST',
    ).values_list('report_id', flat=True).distinct()

    return Response({
        "pending": [_serialize_report(r) for r in qs.filter(status='PENDING', report_id__in=submitted_ids)],
        "approved": [_serialize_report(r) for r in qs.filter(status='APPROVED')],
        "history": [_serialize_report(r) for r in qs.exclude(status='PENDING')],
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
@transaction.atomic
def approve_request(request, id):
    """Approve a workload report. HOD can only approve reports in their department."""
    qs = get_workload_queryset(request.staff)
    report = get_object_or_404(qs, report_id=id)

    if report.status != 'PENDING':
        return Response(
            {"code": "CONFLICT", "message": f"Report is already '{report.status}'."},
            status=409
        )

    # Gate: academic must have submitted this report before HOD can act on it.
    if not AuditLog.objects.filter(report=report, changes__kind='WORKLOAD_REQUEST').exists():
        return Response(
            {"code": "NOT_SUBMITTED", "message": "Academic has not submitted this report for review."},
            status=409
        )

    report.status = 'APPROVED'
    report.save()
    AuditLog.objects.create(report=report, action_by=request.staff, action_type='APPROVE')
    return Response({"message": "Approved", "report_id": str(report.report_id)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
@transaction.atomic
def reject_request(request, id):
    """Reject a workload report. Reason is required."""
    comment = request.data.get('comment', '').strip()
    if not comment:
        return Response(
            {"code": "VALIDATION_ERROR", "message": "comment is required when rejecting."},
            status=422
        )

    qs = get_workload_queryset(request.staff)
    report = get_object_or_404(qs, report_id=id)

    if report.status != 'PENDING':
        return Response(
            {"code": "CONFLICT", "message": f"Report is already '{report.status}'."},
            status=409
        )

    # Gate: academic must have submitted this report before HOD can act on it.
    if not AuditLog.objects.filter(report=report, changes__kind='WORKLOAD_REQUEST').exists():
        return Response(
            {"code": "NOT_SUBMITTED", "message": "Academic has not submitted this report for review."},
            status=409
        )

    report.status = 'REJECTED'
    report.save()
    AuditLog.objects.create(report=report, action_by=request.staff, action_type='REJECT', comment=comment)
    return Response({"message": "Rejected", "report_id": str(report.report_id)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def get_pending_requests(request):
    """Return all PENDING reports scoped to the caller's role."""
    qs = get_workload_queryset(request.staff).filter(status='PENDING').order_by('-created_at')
    return Response([_serialize_report(r) for r in qs])


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOD', 'SCHOOL_OPS', 'HOS')
def get_my_workloads(request):
    """Return the 20 most recent reports scoped to the caller's role."""
    qs = get_workload_queryset(request.staff).order_by('-created_at')[:20]
    return Response([_serialize_report(r) for r in qs])
