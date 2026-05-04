"""
Shared page APIs: profile + avatar + messages (contract §11.1–11.5).

Security notes:
- All endpoints require JWT + an existing Staff row (no anonymous profile reads).
- Avatar uploads: size cap, MIME allowlist, extension validator on the model.
- Messages: thread_key ownership checks; HOD limited to same department as thread owner.
"""

from __future__ import annotations

from datetime import datetime

from django.conf import settings
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from api.models import Message, Staff

PEER_SLUGS = frozenset({'admin', 'hod', 'hos'})
ADMIN_LIKE_ROLES = frozenset({'SCHOOL_OPS', 'HOS'})
MAX_AVATAR_BYTES = 2 * 1024 * 1024
MAX_MESSAGE_CHARS = 5000
DEFAULT_MSG_LIMIT = 50
MAX_MSG_LIMIT = 200


class MessageWriteThrottle(UserRateThrottle):
    """Limit burst POST /messages/ abuse per authenticated user (GET is not throttled)."""

    rate = '60/minute'
    scope = 'message_write'

    def allow_request(self, request, view):
        if request.method != 'POST':
            return True
        return super().allow_request(request, view)


def _ok(message: str, data: dict, extra_headers: dict | None = None) -> Response:
    resp = Response({'success': True, 'message': message, 'data': data})
    if extra_headers:
        for k, v in extra_headers.items():
            resp[k] = v
    return resp


def _err(message: str, errors: dict | None = None, *, http_status: int = status.HTTP_400_BAD_REQUEST) -> Response:
    body: dict = {'success': False, 'message': message}
    if errors:
        body['errors'] = errors
    return Response(body, status=http_status)


def _staff(request) -> Staff:
    return get_object_or_404(Staff, user=request.user)


def _parse_thread_key(thread_key: str) -> tuple[str, str] | None:
    parts = thread_key.split(':', 1)
    if len(parts) != 2:
        return None
    owner_sn, peer = parts[0].strip(), parts[1].strip().lower()
    if len(owner_sn) != 8 or peer not in PEER_SLUGS:
        return None
    return owner_sn, peer


def _assert_can_read_thread(viewer: Staff, thread_key: str) -> None:
    parsed = _parse_thread_key(thread_key)
    if not parsed:
        raise PermissionError('invalid_thread')
    owner_sn, peer = parsed

    if viewer.staff_number == owner_sn:
        return

    if peer == 'admin' and viewer.role in ADMIN_LIKE_ROLES:
        return

    if peer == 'hos' and viewer.role == 'HOS':
        return

    if peer == 'hod' and viewer.role == 'HOD':
        owner = Staff.objects.filter(staff_number=owner_sn).only('department_id').first()
        if owner and owner.department_id == viewer.department_id:
            return

    raise PermissionError('forbidden_thread')


def _resolve_thread_key_for_list(viewer: Staff, peer_slug: str, with_staff_number: str) -> str:
    peer_slug = peer_slug.strip().lower()
    if peer_slug not in PEER_SLUGS:
        raise ValueError('invalid_peer')

    ws = with_staff_number.strip()

    if viewer.role in ADMIN_LIKE_ROLES and peer_slug == 'admin':
        if len(ws) != 8:
            raise ValueError('with_staff_required')
        return f'{ws}:admin'

    if viewer.role == 'HOD' and peer_slug == 'hod':
        if len(ws) != 8:
            raise ValueError('with_staff_required')
        return f'{ws}:hod'

    if viewer.role == 'HOS' and peer_slug == 'hos':
        if len(ws) != 8:
            raise ValueError('with_staff_required')
        return f'{ws}:hos'

    if ws and ws != viewer.staff_number:
        raise ValueError('with_staff_forbidden')

    return f'{viewer.staff_number}:{peer_slug}'


def _resolve_thread_key_for_post(sender: Staff, receiver_role: str, with_staff_number: str | None) -> str:
    slug = receiver_role.strip().lower()
    if slug not in PEER_SLUGS:
        raise ValueError('invalid_peer')

    ws = (with_staff_number or '').strip() or None

    if sender.role in ADMIN_LIKE_ROLES and slug == 'admin':
        if not ws or len(ws) != 8:
            raise ValueError('with_staff_required')
        return f'{ws}:admin'

    if sender.role == 'HOD' and slug == 'hod':
        if not ws or len(ws) != 8:
            raise ValueError('with_staff_required')
        return f'{ws}:hod'

    if sender.role == 'HOS' and slug == 'hos':
        if not ws or len(ws) != 8:
            raise ValueError('with_staff_required')
        return f'{ws}:hos'

    if ws:
        raise ValueError('with_staff_forbidden')

    return f'{sender.staff_number}:{slug}'


def _message_qs_for_thread(thread_key: str) -> QuerySet[Message]:
    return Message.objects.filter(thread_key=thread_key).select_related('sender', 'sender__user')


def _serialize_message_row(m: Message) -> dict:
    dt = timezone.localtime(m.created_at) if settings.USE_TZ else m.created_at
    sender_label = (m.sender.user.first_name or '').strip() or m.sender.user.username
    return {
        'id': m.id,
        'sender': sender_label,
        'message': m.body,
        'time': dt.strftime('%H:%M'),
        'date': dt.strftime('%Y-%m-%d'),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def profile_me(request):
    """
    GET /api/profile/me/
    Contract §11.2 — returns profile envelope used by multiple front-end pages.
    """
    staff = _staff(request)
    avatar_url = None
    if staff.avatar:
        avatar_url = request.build_absolute_uri(staff.avatar.url)

    data = {
        'surname': staff.user.last_name or '',
        'first_name': staff.user.first_name or '',
        'employee_id': staff.staff_number,
        'title': staff.academic_title or '',
        'department': staff.department.name,
        'avatar_url': avatar_url,
    }
    return _ok('Profile loaded', data, extra_headers={'Cache-Control': 'private, max-age=60'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def profile_avatar(request):
    """
    POST /api/profile/avatar/
    multipart field name: avatar (contract §11.3).
    """
    staff = _staff(request)
    upload = request.FILES.get('avatar')
    if not upload:
        return _err('Validation failed', {'avatar': ['This field is required.']})

    if upload.size > MAX_AVATAR_BYTES:
        return _err('Validation failed', {'avatar': ['File too large (max 2MB).']})

    allowed_types = {'image/jpeg', 'image/png', 'image/webp'}
    if (upload.content_type or '').lower() not in allowed_types:
        return _err(
            'Validation failed',
            {'avatar': ['Unsupported image type. Use JPEG, PNG, or WebP.']},
        )

    if staff.avatar:
        staff.avatar.delete(save=False)

    staff.avatar = upload
    staff.save(update_fields=['avatar', 'updated_at'])

    url = request.build_absolute_uri(staff.avatar.url)
    return _ok('Avatar uploaded successfully', {'avatar_url': url})


def _messages_list(request):
    """
    GET /api/messages/
    Query: conversation_with (required), optional date=YYYY-MM-DD, limit, offset.
    """
    staff = _staff(request)
    peer = request.query_params.get('conversation_with', '')
    with_sn = request.query_params.get('with_staff_number', '')

    try:
        thread_key = _resolve_thread_key_for_list(staff, peer, with_sn)
    except ValueError as exc:
        code = str(exc)
        if code == 'with_staff_required':
            return _err(
                'Validation failed',
                {
                    'with_staff_number': [
                        'This field is required for your role when reading this conversation.',
                    ]
                },
            )
        if code == 'with_staff_forbidden':
            return _err('Forbidden', {'with_staff_number': ['Not allowed.']}, http_status=status.HTTP_403_FORBIDDEN)
        return _err('Validation failed', {'conversation_with': ['Invalid value.']})

    try:
        _assert_can_read_thread(staff, thread_key)
    except PermissionError:
        return _err('Forbidden', http_status=status.HTTP_403_FORBIDDEN)

    qs = _message_qs_for_thread(thread_key)

    date_raw = (request.query_params.get('date') or '').strip()
    if date_raw:
        try:
            day = datetime.strptime(date_raw, '%Y-%m-%d').date()
        except ValueError:
            return _err('Validation failed', {'date': ['Expected YYYY-MM-DD.']})
        qs = qs.filter(created_at__date=day)

    try:
        limit = int(request.query_params.get('limit', DEFAULT_MSG_LIMIT))
    except ValueError:
        limit = DEFAULT_MSG_LIMIT
    limit = max(1, min(limit, MAX_MSG_LIMIT))

    try:
        offset = int(request.query_params.get('offset', 0))
    except ValueError:
        offset = 0
    offset = max(0, offset)

    rows = list(qs[offset:offset + limit])
    items = [_serialize_message_row(m) for m in rows]

    resp = _ok('Messages loaded', {'items': items})
    resp['Cache-Control'] = 'private, no-store'
    return resp


def _messages_create(request):
    """
    POST /api/messages/
    Body: receiver_role, message; optional with_staff_number for admin/hod/hos replies.
    """
    staff = _staff(request)
    receiver_role = request.data.get('receiver_role')
    body = (request.data.get('message') or '').strip()
    with_staff_number = request.data.get('with_staff_number')

    if not receiver_role:
        return _err('Validation failed', {'receiver_role': ['This field is required.']})
    if not body:
        return _err('Validation failed', {'message': ['This field is required.']})
    if len(body) > MAX_MESSAGE_CHARS:
        return _err('Validation failed', {'message': [f'Max length is {MAX_MESSAGE_CHARS} characters.']})

    try:
        thread_key = _resolve_thread_key_for_post(staff, str(receiver_role), str(with_staff_number or ''))
    except ValueError as exc:
        code = str(exc)
        if code == 'with_staff_required':
            return _err(
                'Validation failed',
                {'with_staff_number': ['This field is required for your role for this receiver_role.']},
            )
        if code == 'with_staff_forbidden':
            return _err('Forbidden', {'with_staff_number': ['Not allowed.']}, http_status=status.HTTP_403_FORBIDDEN)
        return _err('Validation failed', {'receiver_role': ['Invalid value.']})

    try:
        _assert_can_read_thread(staff, thread_key)
    except PermissionError:
        return _err('Forbidden', http_status=status.HTTP_403_FORBIDDEN)

    msg = Message.objects.create(thread_key=thread_key, sender=staff, body=body)
    payload = _serialize_message_row(msg)
    return _ok('Message sent', payload, extra_headers={'Cache-Control': 'private, no-store'})


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([MessageWriteThrottle])
def messages_view(request):
    """GET/POST /api/messages/ (contract §11.4–11.5)."""
    if request.method == 'GET':
        return _messages_list(request)
    return _messages_create(request)
