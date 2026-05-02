import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.utils import timezone

from api.models import OTPToken, Staff

OTP_EXPIRY_MINUTES = 5


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def request_otp(email: str) -> dict:
    """
    Generate a 6-digit OTP, store its hash, and send it to the given email.

    Returns {"sent": True} on success.
    Raises ValueError if no active User with that email exists.
    """
    email = email.strip().lower()

    try:
        user = User.objects.get(email__iexact=email, is_active=True)
    except User.DoesNotExist:
        # Return success-looking response to avoid email enumeration.
        # The caller cannot distinguish "no account" from "email sent".
        return {"sent": True}

    code = str(secrets.randbelow(900000) + 100000)  # 6-digit, never starts with 0 issue avoided
    code_hash = _hash_code(code)
    expires_at = timezone.now() + timedelta(minutes=OTP_EXPIRY_MINUTES)

    OTPToken.objects.create(email=email, code_hash=code_hash, expires_at=expires_at)

    send_mail(
        subject="Your UWA Workload System login code",
        message=f"Your one-time login code is: {code}\n\nThis code expires in {OTP_EXPIRY_MINUTES} minutes.",
        from_email=None,  # uses DEFAULT_FROM_EMAIL from settings
        recipient_list=[email],
        fail_silently=False,
    )

    return {"sent": True}


def verify_otp(email: str, code: str) -> dict:
    """
    Verify a 6-digit OTP and return JWT tokens + role on success.

    Returns {"access": ..., "refresh": ..., "role": ...} on success.
    Raises ValueError with a user-facing message on failure.
    """
    from rest_framework_simplejwt.tokens import RefreshToken

    email = email.strip().lower()
    code_hash = _hash_code(code.strip())
    now = timezone.now()

    token = (
        OTPToken.objects
        .filter(email=email, code_hash=code_hash, expires_at__gt=now, used_at__isnull=True)
        .order_by('-created_at')
        .first()
    )

    if token is None:
        raise ValueError("Invalid or expired code.")

    # Mark as used immediately to prevent replay.
    token.used_at = now
    token.save(update_fields=['used_at'])

    try:
        user = User.objects.get(email__iexact=email, is_active=True)
    except User.DoesNotExist:
        raise ValueError("Account not found.")

    try:
        staff = Staff.objects.get(user=user)
        role = staff.role
        staff_id = str(staff.staff_id)
    except Staff.DoesNotExist:
        role = 'ACADEMIC'
        staff_id = None

    refresh = RefreshToken.for_user(user)

    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "role": role,
        "staff_id": staff_id,
        "email": user.email,
    }
