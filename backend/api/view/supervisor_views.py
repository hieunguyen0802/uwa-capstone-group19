from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.db import transaction
from ..models import Workload, Request


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def supervisor_requests(request):
    """Return all workloads grouped by status: pending, rejected, and history."""
    queryset = Workload.objects.select_related('user').order_by('-created_at')

    pending = queryset.filter(status='pending')
    rejected = queryset.filter(status='rejected')
    history = queryset.exclude(status='pending')

    def serialize(qs):
        return [
            {
                "id": w.id,
                "username": w.user.username,
                "unit": w.unit,
                "hours": w.hours,
                "is_sent": w.is_sent,
                "status": w.status,
                "created_at": w.created_at.strftime("%Y-%m-%d %H:%M") if w.created_at else None
            }
            for w in qs
        ]

    return Response({
        "pending": serialize(pending),
        "rejected": serialize(rejected),
        "history": serialize(history),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_workload(request):
    """Create a new workload assignment for an academic staff member."""
    data = request.data

    if not data.get('user_id'):
        return Response({"message": "user_id required"}, status=400)

    try:
        workload = Workload.objects.create(
            user_id=data.get('user_id'),
            supervisor_id=data.get('supervisor_id'),
            full_name=data.get('full_name'),
            unit=data.get('unit'),
            title=data.get('title'),
            teaching_ratio=data.get('teaching_ratio'),
            research_ratio=data.get('research_ratio'),
            hours=data.get('hours'),
            semester=data.get('semester'),
            is_sent=True,
        )
        return Response({"message": "Created", "id": workload.id, "is_sent": True})
    except Exception as e:
        return Response({"message": "Failed", "error": str(e), "is_sent": False}, status=500)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def approve_request(request, id):
    """Directly approve a workload by its ID."""
    workload = get_object_or_404(Workload, id=id)
    workload.status = 'approved'
    workload.save()
    return Response({"message": "Approved"})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reject_request(request, id):
    """Directly reject a workload by its ID."""
    workload = get_object_or_404(Workload, id=id)
    workload.status = 'rejected'
    workload.save()
    return Response({"message": "Rejected"})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_my_workloads(request):
    """Return the 10 most recently created workload records (supervisor list view)."""
    workloads = Workload.objects.all().order_by('-id')[:10]
    data = [
        {
            "id": w.id,
            "user_id": w.user_id,
            "full_name": w.full_name,
            "unit": w.unit,
            "hours": w.hours,
            "is_sent": w.is_sent,
            "created_at": w.created_at.strftime("%Y-%m-%d %H:%M")
        }
        for w in workloads
    ]
    return Response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_pending_requests(request):
    """Return all Request records that are pending supervisor review."""
    pending_requests = Request.objects.filter(
        status='pending'
    ).select_related('workload', 'workload__user').order_by('-created_at')

    data = [
        {
            "request_id": r.id,
            "academic_username": r.workload.user.username,
            "workload_id": r.workload.id,
            "unit": r.workload.unit,
            "hours": r.workload.hours,
            "semester": r.workload.semester,
            "action": r.action,
            "comment": r.comment,
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M")
        }
        for r in pending_requests
    ]
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@transaction.atomic  # Update both Request and Workload status atomically.
def action_request(request, request_id):
    """
    Supervisor closes a case by approving or rejecting the academic's request.

    Required body fields:
      - action (str): 'approved' | 'rejected'
    """
    req = get_object_or_404(Request, id=request_id)
    action = request.data.get('action')

    if action not in ['approved', 'rejected']:
        return Response(
            {"error": "action must be 'approved' or 'rejected'"},
            status=400
        )

    # Sync both the Request record and its parent Workload to the same status.
    req.status = action
    req.save()

    req.workload.status = action
    req.workload.save()

    return Response({
        "message": f"Request {action} by supervisor",
        "request_id": req.id
    })
