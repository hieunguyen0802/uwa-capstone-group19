"""
seed_smoke — idempotent fixture loader for end-to-end smoke runs.

Creates 4 canonical users (one per role), 2 departments, and a handful of
WorkloadReports covering every status the golden-path smoke touches.

Re-running is a no-op: all objects keyed on natural keys (username / staff_number).

Usage:
    docker compose -f docker-compose.test.yml exec backend python manage.py seed_smoke
    # or locally: python manage.py seed_smoke
"""
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Department, Staff, WorkloadReport


SEED_PASSWORD = "SmokePass123!"

STAFF_FIXTURES = [
    # (username,   role,          department_key, staff_number, first, last,    email)
    ("academic1", "ACADEMIC",    "CSSE",    "10000001", "Alice",   "Academic",  "alice@uwa.test"),
    ("hod_csse",  "HOD",         "CSSE",    "10000002", "Bob",     "Hod",       "bob@uwa.test"),
    ("ops1",      "SCHOOL_OPS",  "CSSE",    "10000003", "Daniela", "Ops",       "daniela@uwa.test"),
    ("hos1",      "HOS",         "CSSE",    "10000004", "Harold",  "Hos",       "harold@uwa.test"),
]


class Command(BaseCommand):
    help = "Seed canonical smoke-test fixtures (idempotent)."

    @transaction.atomic
    def handle(self, *args, **opts):
        departments = self._ensure_departments()
        staff_by_username = self._ensure_staff(departments)
        self._ensure_hod_link(departments["CSSE"], staff_by_username["hod_csse"])
        self._ensure_reports(staff_by_username)

        self.stdout.write(self.style.SUCCESS("seed_smoke: OK"))
        for username in STAFF_FIXTURES:
            self.stdout.write(f"  login: {username[0]} / {SEED_PASSWORD}  (role={username[1]})")

    def _ensure_departments(self):
        csse, _ = Department.objects.get_or_create(name="CSSE")
        physics, _ = Department.objects.get_or_create(name="Physics")
        return {"CSSE": csse, "Physics": physics}

    def _ensure_staff(self, departments):
        out = {}
        for username, role, dept_key, staff_number, first, last, email in STAFF_FIXTURES:
            user, _ = User.objects.get_or_create(
                username=username,
                defaults={"email": email, "first_name": first, "last_name": last},
            )
            # Always reset password so smoke is deterministic across runs
            user.set_password(SEED_PASSWORD)
            user.email = email
            user.first_name = first
            user.last_name = last
            user.save()

            staff, _ = Staff.objects.update_or_create(
                staff_number=staff_number,
                defaults={
                    "user": user,
                    "role": role,
                    "department": departments[dept_key],
                    "fte": Decimal("1.00"),
                    "is_active": True,
                },
            )
            out[username] = staff
        return out

    def _ensure_hod_link(self, dept, hod_staff):
        if dept.hod_id != hod_staff.staff_id:
            dept.hod = hod_staff
            dept.save(update_fields=["hod"])

    def _ensure_reports(self, staff):
        """One report per status the smoke needs: INITIAL, PENDING, APPROVED."""
        academic = staff["academic1"]
        specs = [
            ("INITIAL",  2025, "S1"),
            ("PENDING",  2025, "S2"),
            ("APPROVED", 2024, "S2"),
        ]
        for status, year, sem in specs:
            WorkloadReport.objects.update_or_create(
                staff=academic,
                academic_year=year,
                semester=sem,
                defaults={
                    "snapshot_fte": academic.fte,
                    "snapshot_department": academic.department,
                    "status": status,
                },
            )
