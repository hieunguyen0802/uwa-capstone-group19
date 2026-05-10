"""
DRF permission classes backed by Django auth Groups and Permissions.

Each role class checks `request.user.groups` against a fixed set of group names.
Permission classes check `request.user.has_perm(...)`.
Staff lookup is done through `api.middleware.get_staff` so we don't depend on
middleware ordering — DRF authentication runs after Django middleware, so any
eager lookup at middleware time would miss the JWT-authenticated user.

Response shape for 403 keeps the frontend contract stable:
    {"code": "FORBIDDEN" | "ACCOUNT_INACTIVE", "message": "..."}

Usage:
    @api_view(['GET'])
    @permission_classes([IsAuthenticated, IsHoS])
    def my_view(request): ...
"""
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from api.middleware import get_staff


class _AccountInactive(PermissionDenied):
    default_detail = {'code': 'ACCOUNT_INACTIVE', 'message': 'Account is inactive.'}


class _RoleForbidden(PermissionDenied):
    default_detail = {'code': 'FORBIDDEN', 'message': 'You do not have permission to access this resource.'}


class HasGroup(BasePermission):
    """Subclass and override `required_groups`.

    Returns False (DRF raises a generic 403) for unauthenticated users, and
    raises `PermissionDenied` with the legacy `{code, message}` body for
    authenticated-but-disallowed cases. This preserves the response contract
    expected by the API contract.
    """

    required_groups: tuple[str, ...] = ()

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return False

        staff = get_staff(request)
        if staff is None:
            raise _RoleForbidden()
        if not staff.is_active:
            raise _AccountInactive()

        if not self.required_groups:
            return True

        user_groups = set(user.groups.values_list('name', flat=True))
        if set(self.required_groups) & user_groups:
            return True
        raise _RoleForbidden()


class HasAnyPermission(HasGroup):
    """Allow active staff with any configured Django auth permission."""

    required_permissions: tuple[str, ...] = ()

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if any(request.user.has_perm(permission) for permission in self.required_permissions):
            return True
        raise _RoleForbidden()


class IsAcademic(HasGroup):
    required_groups = ('ACADEMIC',)


class IsAcademicOrHoD(HasGroup):
    required_groups = ('ACADEMIC', 'HOD')


class IsHoD(HasGroup):
    required_groups = ('HOD',)


class IsSchoolOps(HasGroup):
    required_groups = ('SCHOOL_OPS',)


class IsHoS(HasGroup):
    required_groups = ('HOS',)


class IsHoSOrSchoolOps(HasGroup):
    required_groups = ('HOS', 'SCHOOL_OPS')


class CanAccessSchoolOpsApi(HasAnyPermission):
    required_permissions = ('api.access_school_ops_api',)


class IsApprover(HasGroup):
    """HOD / SCHOOL_OPS / HOS — anyone in the approval chain."""
    required_groups = ('HOD', 'SCHOOL_OPS', 'HOS')


class IsAnyStaff(HasGroup):
    required_groups = ('ACADEMIC', 'HOD', 'SCHOOL_OPS', 'HOS')

