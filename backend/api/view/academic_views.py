from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404
from django.db import transaction
from api.models import Workload, Request


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_my_workloads(request):
    """Return the workload list for the currently authenticated academic."""
    user = request.user
    workloads = Workload.objects.filter(user=user).values(
        'id', 'unit', 'title', 'hours', 'semester', 'status', 'created_at'
    )
    return Response(list(workloads))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@transaction.atomic  # Both DB writes succeed or both roll back together.
def submit_request(request):
    """
    Academic submits an approve or reject decision on a workload record.

    Required body fields:
      - workload_id (int)
      - action      (str): 'approve' | 'reject'
      - comment     (str): mandatory when action == 'reject'
    """
    workload_id = request.data.get('workload_id')
    action = request.data.get('action')
    comment = request.data.get('comment', '')

    if not workload_id or not action:
        return Response(
            {"error": "workload_id and action are required"},
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

    # Filter by user at ORM level to prevent unauthorised access to other users' workloads.
    workload = get_object_or_404(Workload, id=workload_id, user=request.user)

    # Guard against duplicate submissions — only 'pending' workloads can be acted on.
    if workload.status != 'pending':
        return Response(
            {"error": f"This workload is already '{workload.status}', cannot submit again"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Create the request record and update workload status atomically.
    req = Request.objects.create(
        workload=workload,
        action=action,
        comment=comment,
        status='pending'
    )

    workload.status = 'approved' if action == 'approve' else 'rejected'
    workload.save()

    return Response({
        "message": f"Request {action}d successfully",
        "request_id": req.id
    }, status=status.HTTP_201_CREATED)
