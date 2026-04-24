from functools import wraps
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from api.models import Staff


def require_role(*roles):
    """
    Decorator that enforces role-based access control on a view.

    Usage:
        @require_role('HOD', 'HOS')
        def my_view(request, ...):
            staff = request.staff  # injected by this decorator
            ...

    The decorator injects `request.staff` so views don't need to re-query Staff.
    Returns 403 if the authenticated user's role is not in the allowed set.
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            staff = get_object_or_404(Staff, user=request.user)
            if staff.role not in roles:
                return Response(
                    {"code": "FORBIDDEN", "message": "You do not have permission to access this resource."},
                    status=403
                )
            request.staff = staff
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator
