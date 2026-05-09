"""
sync_staff_groups — backfill Django Group membership for all existing Staff.

Problem this solves:
    _sync_group_membership() was added to Staff.save() in the RBAC refactoring
    (commit 8ce4007). Staff records created before that commit have never had
    their Group membership set, so user.get_all_permissions() returns an empty
    set for those users. The frontend RequirePermission guard then blocks all
    three non-HoS roles from accessing their dashboards.

Run this once after initialize_rbac on any environment that had existing Staff
records before the RBAC refactoring.

Idempotent: safe to run multiple times. Adding a user to a group they are
already in is a no-op at the database level.

Usage:
    python manage.py initialize_rbac      # must run first
    python manage.py sync_staff_groups
"""
from django.core.management.base import BaseCommand

from api.models import Staff


class Command(BaseCommand):
    help = "Sync all existing Staff records into their Django Groups."

    def handle(self, *args, **opts):
        staff_qs = Staff.objects.select_related('user').all()
        total = staff_qs.count()
        synced = 0
        skipped = 0

        for staff in staff_qs:
            # Call _sync_group_membership directly instead of staff.save() to
            # avoid touching any Staff or User fields — only auth_user_groups
            # join table is written.
            staff._sync_group_membership()
            groups = list(staff.user.groups.values_list('name', flat=True))
            if groups:
                self.stdout.write(f"  {staff.staff_number} ({staff.role}) → {groups}")
                synced += 1
            else:
                # Group not found — initialize_rbac probably hasn't been run yet.
                self.stdout.write(
                    self.style.WARNING(
                        f"  {staff.staff_number} ({staff.role}) → no Group found "
                        f"(run initialize_rbac first)"
                    )
                )
                skipped += 1

        if skipped:
            self.stdout.write(self.style.WARNING(
                f"\nsync_staff_groups: {synced} synced, {skipped} skipped "
                f"(run `python manage.py initialize_rbac` then re-run this command)"
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"\nsync_staff_groups: {synced}/{total} staff synced to Groups"
            ))
