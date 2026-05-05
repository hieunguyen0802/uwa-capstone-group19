from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from api.services.otp_service import request_otp, verify_otp


@api_view(['POST'])
@permission_classes([AllowAny])
def otp_request_view(request):
    """
    Send a 6-digit OTP to the given email address.

    Request body:
      - email (str): UWA staff email address

    Response 200:
      - {"sent": true}

    Always returns 200 even if the email is not registered (prevents enumeration).
    """
    email = request.data.get('email', '').strip()
    if not email:
        return Response({"error": "email is required"}, status=400)

    result = request_otp(email)
    return Response(result, status=200)


@api_view(['POST'])
@permission_classes([AllowAny])
def otp_verify_view(request):
    """
    Verify a 6-digit OTP and issue JWT tokens.

    Request body:
      - email (str): same email used in request-otp
      - code  (str): 6-digit OTP from email

    Response 200:
      - access    (str): JWT access token
      - refresh   (str): JWT refresh token
      - role      (str): ACADEMIC | HOD | SCHOOL_OPS | HOS
      - staff_id  (str): UUID of the Staff record
      - email     (str): confirmed email address

    Response 400:
      - {"error": "Invalid or expired code."}
    """
    email = request.data.get('email', '').strip()
    code = request.data.get('code', '').strip()

    if not email or not code:
        return Response({"error": "email and code are required"}, status=400)

    try:
        result = verify_otp(email, code)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)

    return Response(result, status=200)
