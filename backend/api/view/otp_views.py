import logging

from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from api.services.otp_service import request_otp, verify_otp

logger = logging.getLogger(__name__)


class OTPRequestThrottle(AnonRateThrottle):
    scope = 'otp_request'


class OTPVerifyThrottle(AnonRateThrottle):
    scope = 'otp_verify'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([OTPRequestThrottle])
def otp_request_view(request):
    """
    Send a 6-digit OTP to the given email address.

    Always returns 200 {"sent": true} regardless of whether the email is
    registered — prevents email enumeration.  The real outcome is logged
    internally.
    """
    email = request.data.get('email', '').strip()
    if not email:
        return Response({"error": "email is required"}, status=400)

    try:
        result = request_otp(email)
    except Exception:
        logger.exception("Unexpected error in OTP request for %s", email)
        return Response({"sent": True}, status=200)

    return Response(result, status=200)


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([OTPVerifyThrottle])
def otp_verify_view(request):
    """
    Verify a 6-digit OTP and issue JWT tokens.

    On any failure (wrong code, expired, inactive user, etc.) returns a
    generic 400 error that does not reveal the specific reason.
    """
    email = request.data.get('email', '').strip()
    code = request.data.get('code', '').strip()

    if not email or not code:
        return Response({"error": "email and code are required"}, status=400)

    try:
        result = verify_otp(email, code)
    except ValueError as exc:
        # exc.args[0] is always _VERIFY_ERROR — a generic message.
        return Response({"error": str(exc)}, status=400)
    except Exception:
        logger.exception("Unexpected error in OTP verify for %s", email)
        return Response({"error": "Invalid email or verification code."}, status=400)

    return Response(result, status=200)
