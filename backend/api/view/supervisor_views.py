from rest_framework.decorators import api_view
from rest_framework.response import Response
from ..models import Workload
from django.shortcuts import get_object_or_404


@api_view(['GET'])
def supervisor_requests(request):

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
def create_workload(request):
    
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

        return Response({
            "message": "Created",
            "id": workload.id,
            "is_sent": True})

    except Exception as e:
        return Response({
            "message": "Failed",
            "error": str(e),
            "is_sent": False}, status=500)

@api_view(['POST'])
def approve_request(request, id):
    workload = get_object_or_404(Workload, id=id)
    workload.status = 'approved'
    workload.save()

    return Response({"message": "Approved"})


@api_view(['POST'])
def reject_request(request, id):
    workload = get_object_or_404(Workload, id=id)
    workload.status = 'rejected'
    workload.save()

    return Response({"message": "Rejected"})

@api_view(['GET'])
def get_my_workloads(request):
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