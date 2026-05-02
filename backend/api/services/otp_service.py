import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.utils import timezone

from api.models import OTPToken, Staff

OTP_EXPIRY_MINUTES = 5
_SALT_BYTES = 16


def _hash_code(code: str, salt: str) -> str:
    # HMAC-style: SHA-256(salt + code). Salt prevents rainbow table attacks
    # against the small 6-digit OTP space.
    return hashlib.sha256(f"{salt}:{code}".encode()).hexdigest()


def _new_salt() -> str:
    return secrets.token_hex(_SALT_BYTES)


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
    salt = _new_salt()
    code_hash = _hash_code(code, salt)
    expires_at = timezone.now() + timedelta(minutes=OTP_EXPIRY_MINUTES)

    OTPToken.objects.create(email=email, code_hash=code_hash, salt=salt, expires_at=expires_at)

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
    code = code.strip()
    now = timezone.now()

    # Fetch all unexpired, unused tokens for this email (typically 0-2 rows).
    # We cannot filter by hash directly because each token has a unique salt.
    candidates = (
        OTPToken.objects
        .filter(email=email, expires_at__gt=now, used_at__isnull=True)
        .order_by('-created_at')
    )

    token = None
    for candidate in candidates:
        if secrets.compare_digest(candidate.code_hash, _hash_code(code, candidate.salt)):
            token = candidate
            break

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
