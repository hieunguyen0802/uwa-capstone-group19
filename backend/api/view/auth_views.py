from django.contrib.auth import authenticate
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from api.models import Staff


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    """
    Authenticate a user and return JWT access + refresh tokens.

    Request body:
      - email    (str): username field (Django uses username internally)
      - password (str)

    Response:
      - access   (str): short-lived JWT for API requests (8 hours)
      - refresh  (str): long-lived token to obtain new access tokens (7 days)
      - role     (str): 'academic' | 'supervisor'
    """
    email = request.data.get('email')
    password = request.data.get('password')

    user = authenticate(username=email, password=password)

    if not user:
        return Response({"error": "Invalid credentials"}, status=400)

    # Look up the user's role from the Staff table.
    # Falls back to 'academic' if no Staff record exists.
    try:
        staff = Staff.objects.get(user=user)
        role = staff.role
    except Staff.DoesNotExist:
        role = 'academic'

    refresh = RefreshToken.for_user(user)

    return Response({
        "message": "Login successful",
        "user_id": user.id,
        "username": user.username,
        "role": role,
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    })
