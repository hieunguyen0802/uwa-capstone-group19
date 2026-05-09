"""
initialize_rbac — set up Django Groups + Permissions that mirror Staff.role.

Idempotent. Safe to run multiple times.

Groups created (one per business role):
    ACADEMIC, HOD, SCHOOL_OPS, HOS

Each Group is granted a set of custom Permissions (codenames) that the frontend
uses to decide which menu items / pages to render. Permissions are attached to
the Staff model via Meta.permissions in models.py, not hard-coded here.

Usage:
    python manage.py initialize_rbac
"""
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Staff


# Permission codename → set of roles that should have it.
# Keep codenames short and stable; frontend reads them verbatim.
ROLE_PERMISSIONS: dict[str, list[str]] = {
    # HOS does not use the Academic page per UserGuides section 2.1.
    "view_academic_page":     ["ACADEMIC", "HOD"],
    "view_hod_page":          ["HOD"],
    "view_school_ops_page":   ["SCHOOL_OPS"],
    "view_hos_page":          ["HOS"],
    "approve_workload_dept":  ["HOD"],
    "approve_workload_school":["HOS"],
    "import_workload":        ["SCHOOL_OPS"],
    "manage_staff":           ["SCHOOL_OPS", "HOS"],
}


class Command(BaseCommand):
    help = "Create Groups + Permissions matching Staff.role roles."

    @transaction.atomic
    def handle(self, *args, **opts):
        staff_ct = ContentType.objects.get_for_model(Staff)

        # Ensure every codename exists as a Django Permission.
        perm_objs = {}
        for codename in ROLE_PERMISSIONS:
            perm, _ = Permission.objects.get_or_create(
                codename=codename,
                content_type=staff_ct,
                defaults={"name": codename.replace("_", " ").title()},
            )
            perm_objs[codename] = perm

        # Ensure every role has a Group with the right Permission set.
        role_codes = ("ACADEMIC", "HOD", "SCHOOL_OPS", "HOS")
        for role in role_codes:
            group, _ = Group.objects.get_or_create(name=role)
            desired = [
                perm_objs[code]
                for code, roles in ROLE_PERMISSIONS.items()
                if role in roles
            ]
            group.permissions.set(desired)
            self.stdout.write(
                f"  Group {role}: {len(desired)} permissions"
            )

        self.stdout.write(self.style.SUCCESS("initialize_rbac: OK"))
