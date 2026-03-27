from django.shortcuts import render

# Create your views here.

from django.http import JsonResponse
from .models import Staff

def get_staff(request):
    data = list(Staff.objects.values())
    return JsonResponse(data, safe=False)