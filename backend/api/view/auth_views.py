import logging

from django.contrib.auth import authenticate
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken
from api.models import Staff

logger = logging.getLogger(__name__)


class LoginRateThrottle(AnonRateThrottle):
    # 5 attempts per minute per IP — configurable via THROTTLE_RATES['login'] in settings
    scope = 'login'
    rate = '5/minute'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle])
def login_view(request):
    """
    Authenticate a user and return JWT access + refresh tokens.

    Request body:
      - email    (str): username field (Django uses username internally)
      - password (str)

    Response:
      - access   (str): short-lived JWT for API requests (8 hours)
      - refresh  (str): long-lived token to obtain new access tokens (7 days)
      - role     (str): staff role from the Staff table
    """
    email = (request.data.get('email') or '').strip()
    staff_id = (request.data.get('staff_id') or '').strip()
    password = request.data.get('password')

    if not email and not staff_id:
        return Response({"error": "email or staff_id is required"}, status=400)

    candidates = []
    if email:
        candidates.append(email)
        staff_by_email = Staff.objects.select_related('user').filter(user__email__iexact=email).first()
        if staff_by_email:
            candidates.append(staff_by_email.user.username)

    if staff_id:
        staff_by_id = Staff.objects.select_related('user').filter(staff_number=staff_id).first()
        if staff_by_id:
            candidates.append(staff_by_id.user.username)

    # Keep insertion order while removing duplicates.
    candidate_usernames = list(dict.fromkeys(candidates))

    user = None
    for username in candidate_usernames:
        user = authenticate(username=username, password=password)
        if user:
            break

    if not user:
        # Log failed attempt without exposing which field was wrong (prevents enumeration)
        identifier = staff_id or email
        logger.warning('Login failed for identifier=%s ip=%s', identifier, _get_client_ip(request))
        return Response({"error": "Invalid credentials"}, status=400)

    # Require a Staff record — no fallback to a default role.
    # A Django User without a Staff record is not a valid system user.
    try:
        staff = Staff.objects.get(user=user)
    except Staff.DoesNotExist:
        logger.error('Login blocked: User pk=%s has no Staff record', user.pk)
        return Response({"error": "Account not configured. Contact your administrator."}, status=403)

    if not staff.is_active:
        logger.warning('Login blocked: inactive staff pk=%s', staff.pk)
        return Response({"error": "Account is inactive."}, status=403)

    logger.info('Login success: staff_number=%s role=%s ip=%s', staff.staff_number, staff.role, _get_client_ip(request))

    refresh = RefreshToken.for_user(user)

    return Response({
        "message": "Login successful",
        "role": staff.role,
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    })


def _get_client_ip(request):
    """Extract real client IP, respecting X-Forwarded-For when behind a proxy."""
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '')
