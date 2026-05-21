import hashlib
import logging
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.utils import timezone

from api.models import OTPToken, Staff

logger = logging.getLogger(__name__)

OTP_EXPIRY_MINUTES = 5
_SALT_BYTES = 16

# Generic message shown to the caller for all verify failures.
# Never change this to something role/state-specific — it would leak information.
_VERIFY_ERROR = "Invalid email or verification code."


def _hash_code(code: str, salt: str) -> str:
    # HMAC-style: SHA-256(salt + code). Salt prevents rainbow table attacks
    # against the small 6-digit OTP space.
    return hashlib.sha256(f"{salt}:{code}".encode()).hexdigest()


def _new_salt() -> str:
    return secrets.token_hex(_SALT_BYTES)


def request_otp(email: str) -> dict:
    """
    Generate a 6-digit OTP, store its hash, and send it to the given email.

    Returns {"sent": True} in ALL cases — whether the email is known or not —
    to prevent email enumeration attacks.  The real rejection reason is logged
    internally so developers can debug without exposing it to callers.
    """
    email = email.strip().lower()

    # ── Guard 1: Django User must exist and be active ──────────────────────
    try:
        user = User.objects.get(email__iexact=email, is_active=True)
    except User.DoesNotExist:
        logger.info("OTP request rejected [EMAIL_NOT_FOUND]: %s", email)
        return {"sent": True}

    # ── Guard 2: Staff record must exist (user has been imported) ──────────
    try:
        staff = Staff.objects.get(user=user)
    except Staff.DoesNotExist:
        logger.info("OTP request rejected [STAFF_NOT_IMPORTED]: %s", email)
        return {"sent": True}

    # ── Guard 3: Staff profile must be active ─────────────────────────────
    if not staff.is_active:
        logger.info("OTP request rejected [STAFF_INACTIVE]: %s", email)
        return {"sent": True}

    # All guards passed — generate and send the OTP.
    code = str(secrets.randbelow(900000) + 100000)
    salt = _new_salt()
    code_hash = _hash_code(code, salt)
    expires_at = timezone.now() + timedelta(minutes=OTP_EXPIRY_MINUTES)

    OTPToken.objects.create(email=email, code_hash=code_hash, salt=salt, expires_at=expires_at)

    send_mail(
        subject="Your UWA Workload System login code",
        message=f"Your one-time login code is: {code}\n\nThis code expires in {OTP_EXPIRY_MINUTES} minutes.",
        from_email=None,
        recipient_list=[email],
        fail_silently=False,
    )

    logger.info("OTP sent successfully to %s (role=%s)", email, staff.role)
    return {"sent": True}


def verify_otp(email: str, code: str) -> dict:
    """
    Verify a 6-digit OTP and return JWT tokens + role on success.

    Returns {"access": ..., "refresh": ..., "role": ...} on success.
    Raises ValueError(_VERIFY_ERROR) on ANY failure — never revealing the
    specific reason to the caller.  Internal reason is logged for debugging.
    """
    from rest_framework_simplejwt.tokens import RefreshToken

    email = email.strip().lower()
    code = code.strip()
    now = timezone.now()

    # ── Step 1: find a valid, unused OTP token ────────────────────────────
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
        logger.info("OTP verify failed [INVALID_OR_EXPIRED_TOKEN]: %s", email)
        raise ValueError(_VERIFY_ERROR)

    # ── Step 2: user must still be active ────────────────────────────────
    try:
        user = User.objects.get(email__iexact=email, is_active=True)
    except User.DoesNotExist:
        logger.warning("OTP verify failed [USER_INACTIVE_OR_MISSING] after valid token: %s", email)
        raise ValueError(_VERIFY_ERROR)

    # ── Step 3: staff record must exist and be active ─────────────────────
    try:
        staff = Staff.objects.get(user=user)
    except Staff.DoesNotExist:
        logger.warning("OTP verify failed [STAFF_NOT_IMPORTED] after valid token: %s", email)
        raise ValueError(_VERIFY_ERROR)

    if not staff.is_active:
        logger.warning("OTP verify failed [STAFF_INACTIVE] after valid token: %s", email)
        raise ValueError(_VERIFY_ERROR)

    # ── Step 4: issue JWT tokens ──────────────────────────────────────────
    refresh = RefreshToken.for_user(user)

    # Mark as used only after JWT generation succeeds, so a backend error
    # doesn't burn the token without issuing credentials.
    token.used_at = now
    token.save(update_fields=['used_at'])

    logger.info("OTP verify succeeded for %s (role=%s)", email, staff.role)

    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "role": staff.role,
        "staff_id": str(staff.staff_id),
        "email": user.email,
    }
