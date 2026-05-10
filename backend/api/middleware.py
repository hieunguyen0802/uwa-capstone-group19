"""
StaffContextMiddleware — provide lazy `request.staff` for non-DRF code paths.

DRF permission classes call `get_staff(request)` directly (see api.permissions),
so they do not depend on this middleware. Plain Django views and downstream
code that expects `request.staff` benefit from the lazy property installed here.

Lazy is necessary because JWT authentication happens inside DRF, after the
Django middleware chain — resolving `request.user` eagerly here would see
AnonymousUser on every authenticated request.
"""
from api.models import Staff


_STAFF_ATTR = '_cached_staff'
_UNSET = object()


def get_staff(request):
    """Resolve `Staff` for the current authenticated user; cache on the request.

    Safe to call multiple times. Returns None for anonymous or unmatched users.
    """
    cached = getattr(request, _STAFF_ATTR, _UNSET)
    if cached is not _UNSET:
        return cached
    user = getattr(request, 'user', None)
    staff = None
    if user is not None and user.is_authenticated:
        staff = (
            Staff.objects.select_related('user', 'department')
            .filter(user=user)
            .first()
        )
    setattr(request, _STAFF_ATTR, staff)
    return staff


class StaffContextMiddleware:
    """Exposes `request.staff` as a lazy property for non-DRF callers."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.__class__ = _lazy_subclass(request.__class__)
        return self.get_response(request)


_SUBCLASS_CACHE: dict[type, type] = {}


def _lazy_subclass(cls):
    cached = _SUBCLASS_CACHE.get(cls)
    if cached is not None:
        return cached

    class _WithStaff(cls):
        @property
        def staff(self):
            return get_staff(self)

        @staff.setter
        def staff(self, value):
            setattr(self, _STAFF_ATTR, value)

    _WithStaff.__name__ = f'{cls.__name__}WithStaff'
    _SUBCLASS_CACHE[cls] = _WithStaff
    return _WithStaff
