"""
Backfill Django Group membership for all existing Staff.

Run this once after initialize_rbac on environments that already had Staff
records before Staff.save() started syncing Django Groups.

Usage:
    python manage.py initialize_rbac
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
            # Touch only the auth_user_groups join table.
            staff._sync_group_membership()
            if staff.user.groups.filter(name=staff.role).exists():
                self.stdout.write(f"  {staff.staff_number} ({staff.role}) synced")
                synced += 1
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f"  {staff.staff_number} ({staff.role}) no Group found "
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
