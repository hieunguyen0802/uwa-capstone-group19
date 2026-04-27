from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import transaction
from django.shortcuts import get_object_or_404
from api.models import WorkloadReport, AuditLog
from api.decorators import require_role


def _serialize_hod_report(report):
    return {
        "report_id": str(report.report_id),
        "staff_number": report.staff.staff_number,
        "staff_name": report.staff.user.get_full_name(),
        "department": report.snapshot_department.name,
        "academic_year": report.academic_year,
        "semester": report.semester,
        "is_anomaly": report.is_anomaly,
        "status": report.status,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('HOS')
def get_hod_summary(request):
    """
    GET /api/workloads/hod-summary/
    Returns all current HOD WorkloadReports for HOS review.
    """
    qs = (
        WorkloadReport.objects.filter(is_current=True, staff__role='HOD')
        .select_related('staff__user', 'staff__department', 'snapshot_department')
        .order_by('-created_at')
    )
    return Response([_serialize_hod_report(r) for r in qs])


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@require_role('HOS')
@transaction.atomic
def hos_approve(request, id):
    """
    POST /api/workloads/<id>/hos-approve/
    HOS approves a HOD's workload report. Reason is optional.
    Errors: 404 if not a HOD report, 409 if already actioned.
    """
    report = get_object_or_404(
        WorkloadReport.objects.filter(is_current=True, staff__role='HOD'),
        report_id=id,
    )

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
@require_role('HOS')
@transaction.atomic
def hos_reject(request, id):
    """
    POST /api/workloads/<id>/hos-reject/
    HOS rejects a HOD's workload report. Reason is required.
    Errors: 404 if not a HOD report, 409 if already actioned, 422 if reason missing.
    """
    reason = (request.data.get('reason') or '').strip()
    if not reason:
        return Response(
            {"code": "VALIDATION_ERROR", "message": "reason is required when rejecting."},
            status=422,
        )

    report = get_object_or_404(
        WorkloadReport.objects.filter(is_current=True, staff__role='HOD'),
        report_id=id,
    )

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
