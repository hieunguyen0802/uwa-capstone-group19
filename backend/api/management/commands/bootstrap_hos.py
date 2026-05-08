"""
bootstrap_hos — create / update the Head of School account for Jiaao Li.

Idempotent: re-running syncs the fields to whatever this file says. Meant to
bring up a fresh env to a usable state for end-to-end login testing.

Prereqs:
    python manage.py migrate
    python manage.py initialize_rbac

Usage:
    python manage.py bootstrap_hos
"""
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Department, Staff


HOS_STAFF_NUMBER = "24140443"
HOS_EMAIL = "24140443@student.uwa.edu.au"
HOS_FIRST_NAME = "Jiaao"
HOS_LAST_NAME = "Li"
HOS_USERNAME = HOS_STAFF_NUMBER  # username = staff_number keeps mental model simple
HOS_DEFAULT_DEPT = "School of Physics, Mathematics and Computing"


class Command(BaseCommand):
    help = "Create or refresh the Head of School account used for login testing."

    @transaction.atomic
    def handle(self, *args, **opts):
        dept, created_dept = Department.objects.get_or_create(
            name=HOS_DEFAULT_DEPT,
        )
        if created_dept:
            self.stdout.write(f"  created Department: {dept.name}")

        user, created_user = User.objects.update_or_create(
            username=HOS_USERNAME,
            defaults={
                "email": HOS_EMAIL,
                "first_name": HOS_FIRST_NAME,
                "last_name": HOS_LAST_NAME,
                "is_active": True,
            },
        )
        # OTP login only — no password. set_unusable_password blocks the
        # legacy password login path for this account.
        user.set_unusable_password()
        user.save()

        staff, created_staff = Staff.objects.update_or_create(
            staff_number=HOS_STAFF_NUMBER,
            defaults={
                "user": user,
                "role": "HOS",
                "department": dept,
                "fte": Decimal("1.00"),
                "employment_type": "FULL_TIME",
                "academic_title": "",
                "title": "",
                "is_active": True,
                "is_new_employee": False,
            },
        )
        # Staff.save() hook syncs Group membership → HoS group after this point.

        verb = "created" if created_staff else "refreshed"
        self.stdout.write(self.style.SUCCESS(
            f"bootstrap_hos: {verb} HoS account "
            f"staff_number={staff.staff_number} email={user.email} "
            f"role={staff.role}"
        ))
