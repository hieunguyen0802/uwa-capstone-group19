from django.shortcuts import render
from django.http import JsonResponse

from django.contrib.auth import authenticate
from rest_framework.decorators import api_view
from rest_framework.response import Response

@api_view(['POST'])
def login_view(request):
    email = request.data.get('email')
    password = request.data.get('password')

    user = authenticate(username=email, password=password)

    if user:
        return Response({
            "message": "Login successful",
            "user_id": user.id,
            "role": "academic"
        })
    else:
        return Response({"error": "Invalid credentials"}, status=400)