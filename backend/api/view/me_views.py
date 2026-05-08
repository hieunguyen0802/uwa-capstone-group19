"""
Authenticated user profile — single endpoint the frontend polls on every
page load to decide what to render.

Returns the role, the set of permission codenames the user has, and a menu
structure that maps each top-level page to the permission that unlocks it.
The frontend must treat this response as authoritative: never hard-code
which pages a role can see.
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.models import Staff


# Menu item → permission codename that unlocks it. Frontend renders an entry
# only if its `permission` is in the user's `permissions` list.
MENU_ITEMS = [
    {"key": "academic",         "label": "Academic",           "route": "/academic",          "permission": "api.view_academic_page"},
    {"key": "department-head",  "label": "Head of Department", "route": "/department-head",   "permission": "api.view_hod_page"},
    {"key": "school-operations","label": "School Operations",  "route": "/school-operations", "permission": "api.view_school_ops_page"},
    {"key": "school-head",      "label": "Head of School",     "route": "/school-head",       "permission": "api.view_hos_page"},
]


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def auth_me_view(request):
    """Return the caller's identity, role, permission codenames, and menu."""
    user = request.user
    try:
        staff = Staff.objects.select_related('user', 'department').get(user=user)
    except Staff.DoesNotExist:
        return Response({"error": "Account not configured."}, status=403)

    if not staff.is_active:
        return Response({"error": "Account is inactive."}, status=403)

    # user.get_all_permissions() returns a set like {'api.view_hos_page', ...}
    permissions = sorted(user.get_all_permissions())

    menu = [item for item in MENU_ITEMS if item["permission"] in permissions]

    return Response({
        "staff_id": str(staff.staff_id),
        "staff_number": staff.staff_number,
        "email": user.email,
        "full_name": user.get_full_name(),
        "role": staff.role,
        "department": staff.department.name if staff.department_id else None,
        "permissions": permissions,
        "menu": menu,
    })
