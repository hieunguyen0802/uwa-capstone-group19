from functools import wraps
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from api.models import Staff


def require_role(*roles):
    """
    Role-based access control backed by Django Groups.

    Internally resolves the user's role by checking Django Group membership
    (ACADEMIC / HOD / SCHOOL_OPS / HOS) rather than reading Staff.role directly.
    Staff.role is kept as the source of truth in the DB; Staff.save() syncs the
    matching Group membership. This lets legacy @require_role('HOS') calls keep
    working while the permission layer is Django-native.

    Usage:
        @require_role('HOD', 'HOS')
        def my_view(request, ...):
            staff = request.staff  # injected by this decorator
            ...

    Returns 403 if the user's Group set does not intersect the allowed roles.
    """
    allowed = set(roles)

    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            staff = get_object_or_404(Staff, user=request.user)
            if not staff.is_active:
                return Response(
                    {"code": "ACCOUNT_INACTIVE", "message": "Account is inactive."},
                    status=403,
                )

            user_roles = set(request.user.groups.values_list('name', flat=True))
            # Fallback: if Groups haven't been initialised yet, honour Staff.role
            # so dev environments that forgot `initialize_rbac` don't break.
            if not user_roles:
                user_roles = {staff.role}

            if not (allowed & user_roles):
                return Response(
                    {"code": "FORBIDDEN", "message": "You do not have permission to access this resource."},
                    status=403,
                )

            request.staff = staff
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator
