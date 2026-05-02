"""
Unified Excel importer for the UWA Workload System.

Reads the extended Nidhi template (34 original columns + 5 new columns)
and creates/updates Staff, User, WorkloadReport, and WorkloadItem records.

Column layout (0-indexed after inserting 5 new columns at the front):
  0  Academic Year      (new)
  1  Semester           (new)
  2  Email              (new)
  3  Department         (new)
  4  Role               (new)
  5  Staff Member ID    (original A — ignored)
  6  Staff Name         (original B — "Doe, John")
  7  Staff Number       (original C — primary key)
  8  FTE                (original D)
  9  Function           (original E — ignored)
  10 Target Band        (original F)
  11 Target Teaching %  (original G)
  12 Unit Code          (original H)
  13 Unit Enrolment     (original I — ignored)
  14 Staff Type         (original J — ignored)
  15 Teaching Hrs       (original K)
  16 Teaching WL Pts    (original L — ignored)
  17 Unit Coord Hrs     (original M)
  18 Unit Coord WL Pts  (original N — ignored)
  19 Teaching Activity Hrs    (original O)
  20 Teaching Activity WL Pts (original P — ignored)
  21 Unit Supervision Hrs     (original Q)
  22 Unit Supervision WL Pts  (original R — ignored)
  23 New Unit Dev Hrs         (original S)
  24 New Unit Dev WL Pts      (original T — ignored)
  25 Total Teaching WL Pts    (original U — ignored, recalculated)
  26 FT Students        (original V — ignored)
  27 FT Proportion      (original W — ignored)
  28 PT Students        (original X — ignored)
  29 PT Proportion      (original Y — ignored)
  30 HDR Total Hrs      (original Z)
  31 HDR WL Pts         (original AA — ignored)
  32 Self-Directed Svc Pts    (original AB — pts, convert × 17.25)
  33 Assigned Roles Total Pts (original AC — ignored, sum of roles)
  34 Role 1 Name        (original AD)
  35 Role 1 Points      (original AE — pts, convert × 17.25)
  36 Role 2 Name        (original AF)
  37 Role 2 Points      (original AG — pts, convert × 17.25)
  38 Role 3 Name        (original AH)
  39 Role 3 Points      (original AI — if present)
"""

import uuid
from decimal import Decimal, InvalidOperation
from itertools import groupby

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from api.models import AuditLog, Department, OTPToken, Staff, WorkloadItem, WorkloadReport

POINT_TO_HOURS = Decimal('17.25')

# Column indices (0-based)
COL_YEAR = 0
COL_SEMESTER = 1
COL_EMAIL = 2
COL_DEPARTMENT = 3
COL_ROLE = 4
COL_STAFF_NAME = 6
COL_STAFF_NUMBER = 7
COL_FTE = 8
COL_TARGET_BAND = 10
COL_TARGET_TEACHING_PCT = 11
COL_UNIT_CODE = 12
COL_TEACHING_HRS = 15
COL_UNIT_COORD_HRS = 17
COL_TEACHING_ACTIVITY_HRS = 19
COL_UNIT_SUPERVISION_HRS = 21
COL_NEW_UNIT_DEV_HRS = 23
COL_HDR_HRS = 30
COL_SERVICE_PTS = 32
COL_ROLE1_NAME = 34
COL_ROLE1_PTS = 35
COL_ROLE2_NAME = 36
COL_ROLE2_PTS = 37
COL_ROLE3_NAME = 38
COL_ROLE3_PTS = 39  # may not exist in all templates

VALID_SEMESTERS = {'S1', 'S2', 'FULL_YEAR'}
VALID_ROLES = {'ACADEMIC', 'HOD', 'SCHOOL_OPS', 'HOS'}

# Re-import protection: these (status, is_confirmed) combinations are protected.
# is_confirmed = True means an AuditLog CONFIRMATION entry exists for this report.
PROTECTED_STATES = {
    ('PENDING', True),
    ('APPROVED', True),
    ('APPROVED', False),
}


def _dec(value, default=Decimal('0.00')) -> Decimal:
    if value is None or value == '':
        return default
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return default


def _str(value) -> str:
    if value is None:
        return ''
    return str(value).strip()


def _is_confirmed(report: WorkloadReport) -> bool:
    return report.audit_logs.filter(action_type='CONFIRMATION').exists()


def _parse_name(raw: str):
    """Parse 'Doe, John' → (first_name='John', last_name='Doe')."""
    if ',' in raw:
        parts = raw.split(',', 1)
        return parts[1].strip(), parts[0].strip()
    parts = raw.strip().split(' ', 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return raw.strip(), ''


def _upsert_staff(row, importing_staff: Staff) -> Staff:
    """Create or update Staff + User from a single row."""
    staff_number = _str(row[COL_STAFF_NUMBER])
    email = _str(row[COL_EMAIL]).lower()
    raw_name = _str(row[COL_STAFF_NAME])
    first_name, last_name = _parse_name(raw_name)
    fte = _dec(row[COL_FTE], Decimal('1.00'))
    role = _str(row[COL_ROLE]).upper()
    dept_name = _str(row[COL_DEPARTMENT])

    if role not in VALID_ROLES:
        role = 'ACADEMIC'

    dept = Department.objects.get(name=dept_name)

    try:
        staff = Staff.objects.select_related('user').get(staff_number=staff_number)
        user = staff.user
        # Update mutable fields; email change only if not confirmed-locked
        user.first_name = first_name
        user.last_name = last_name
        if email:
            user.email = email
            user.username = email
        user.save()
        staff.fte = fte
        staff.role = role
        staff.department = dept
        staff.save()
    except Staff.DoesNotExist:
        # Create Django User (no password — OTP login only)
        username = email or staff_number
        user, _ = User.objects.get_or_create(
            username=username,
            defaults={'email': email, 'first_name': first_name, 'last_name': last_name}
        )
        if not _:
            user.first_name = first_name
            user.last_name = last_name
            user.email = email
            user.save()
        staff = Staff.objects.create(
            staff_number=staff_number,
            user=user,
            fte=fte,
            role=role,
            department=dept,
        )

    return staff


def _is_protected(report: WorkloadReport) -> bool:
    confirmed = _is_confirmed(report)
    return (report.status, confirmed) in PROTECTED_STATES


def import_workload_excel(workbook, importing_staff: Staff) -> dict:
    """
    Parse an openpyxl Workbook and import all data.

    Returns a summary dict:
      {
        "created": int,
        "updated": int,
        "skipped": int,
        "errors": [{"row": int, "message": str}],
      }
    """
    ws = workbook.active

    # Find header row (row where cell A contains 'Academic Year')
    header_row_idx = None
    for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if row and _str(row[0]).lower() == 'academic year':
            header_row_idx = i
            break

    if header_row_idx is None:
        return {"created": 0, "updated": 0, "skipped": 0,
                "errors": [{"row": 0, "message": "Header row not found. Expected 'Academic Year' in column A."}]}

    data_rows = list(ws.iter_rows(min_row=header_row_idx + 1, values_only=True))
    # Filter out completely empty rows
    data_rows = [r for r in data_rows if any(c is not None and _str(c) != '' for c in r)]

    summary = {"created": 0, "updated": 0, "skipped": 0, "errors": []}
    batch_id = uuid.uuid4()

    # Sort rows by (staff_number, year, semester) for groupby
    def row_key(r):
        return (_str(r[COL_STAFF_NUMBER]), _str(r[COL_YEAR]), _str(r[COL_SEMESTER]))

    sorted_rows = sorted(enumerate(data_rows, start=header_row_idx + 1), key=lambda x: row_key(x[1]))

    for group_key, group_iter in groupby(sorted_rows, key=lambda x: row_key(x[1])):
        group = list(group_iter)
        staff_number, year_str, semester = group_key

        if not staff_number or not year_str or not semester:
            for row_num, _ in group:
                summary["errors"].append({"row": row_num, "message": "Missing staff_number, year, or semester."})
            continue

        if semester not in VALID_SEMESTERS:
            for row_num, _ in group:
                summary["errors"].append({"row": row_num, "message": f"Invalid semester '{semester}'."})
            continue

        try:
            year = int(year_str)
        except (ValueError, TypeError):
            for row_num, _ in group:
                summary["errors"].append({"row": row_num, "message": f"Invalid academic year '{year_str}'."})
            continue

        first_row_num, first_row = group[0]

        try:
            with transaction.atomic():
                staff = _upsert_staff(first_row, importing_staff)

                # Check for existing report and apply re-import protection
                existing = (
                    WorkloadReport.objects
                    .filter(staff=staff, academic_year=year, semester=semester, is_current=True)
                    .first()
                )

                if existing and _is_protected(existing):
                    # Write IMPORT_SKIP audit log
                    AuditLog.objects.create(
                        report=existing,
                        action_by=importing_staff,
                        action_type='IMPORT_SKIP',
                        changes={"reason": f"protected: status={existing.status}, confirmed={_is_confirmed(existing)}"},
                    )
                    summary["skipped"] += 1
                    continue

                # Supersede existing record if present
                if existing:
                    existing.is_current = False
                    existing.save(update_fields=['is_current'])

                target_band = _str(first_row[COL_TARGET_BAND]) or None
                target_pct_raw = first_row[COL_TARGET_TEACHING_PCT] if len(first_row) > COL_TARGET_TEACHING_PCT else None
                target_teaching_pct = _dec(target_pct_raw) if target_pct_raw else None

                report = WorkloadReport.objects.create(
                    staff=staff,
                    academic_year=year,
                    semester=semester,
                    snapshot_fte=staff.fte,
                    snapshot_department=staff.department,
                    status='INITIAL',
                    import_batch_id=batch_id,
                    is_current=True,
                    target_band=target_band,
                    target_teaching_pct=target_teaching_pct,
                )

                if existing:
                    existing.superseded_by = report
                    existing.save(update_fields=['superseded_by'])

                # Create WorkloadItems from all rows in this group
                _create_workload_items(report, group, first_row)

                # Evaluate anomaly after items are created
                from api.services.workload_service import evaluate_mvp_anomaly, persist_report_anomaly
                anomaly_result = evaluate_mvp_anomaly(report)
                persist_report_anomaly(report, anomaly_result)

                action = 'MODIFIED_BY_REIMPORT' if existing else 'IMPORTED'
                AuditLog.objects.create(
                    report=report,
                    action_by=importing_staff,
                    action_type=action,
                    changes={"import_batch_id": str(batch_id)},
                )

                if existing:
                    summary["updated"] += 1
                else:
                    summary["created"] += 1

        except Department.DoesNotExist:
            dept_name = _str(first_row[COL_DEPARTMENT])
            summary["errors"].append({"row": first_row_num, "message": f"Department '{dept_name}' not found in database."})
        except Exception as exc:
            summary["errors"].append({"row": first_row_num, "message": str(exc)})

    return summary


def _create_workload_items(report: WorkloadReport, group: list, first_row):
    """Create all WorkloadItems for a report from the grouped rows."""
    # Teaching items: one WorkloadItem per sub-type per row (unit_code distinguishes rows)
    teaching_sub_types = [
        ('Teaching Hrs', COL_TEACHING_HRS),
        ('Unit Coord Hrs', COL_UNIT_COORD_HRS),
        ('Teaching Activity Hrs', COL_TEACHING_ACTIVITY_HRS),
        ('Unit Supervision Hrs', COL_UNIT_SUPERVISION_HRS),
        ('New Unit Dev Hrs', COL_NEW_UNIT_DEV_HRS),
    ]

    for _row_num, row in group:
        unit_code = _str(row[COL_UNIT_CODE]) or None
        for description, col_idx in teaching_sub_types:
            hrs = _dec(row[col_idx] if len(row) > col_idx else None)
            if hrs > 0:
                WorkloadItem.objects.create(
                    report=report,
                    category='TEACHING',
                    unit_code=unit_code,
                    description=description,
                    allocated_hours=hrs,
                )

    # HDR, Service, Roles: read from first row only (repeated across all rows for same staff)
    hdr_hrs = _dec(first_row[COL_HDR_HRS] if len(first_row) > COL_HDR_HRS else None)
    if hdr_hrs > 0:
        WorkloadItem.objects.create(
            report=report, category='HDR_SUPERVISION', allocated_hours=hdr_hrs
        )

    svc_pts = _dec(first_row[COL_SERVICE_PTS] if len(first_row) > COL_SERVICE_PTS else None)
    if svc_pts > 0:
        WorkloadItem.objects.create(
            report=report, category='SERVICE', allocated_hours=svc_pts * POINT_TO_HOURS
        )

    role_pairs = [
        (COL_ROLE1_NAME, COL_ROLE1_PTS),
        (COL_ROLE2_NAME, COL_ROLE2_PTS),
        (COL_ROLE3_NAME, COL_ROLE3_PTS),
    ]
    for name_col, pts_col in role_pairs:
        if len(first_row) <= pts_col:
            break
        role_name = _str(first_row[name_col] if len(first_row) > name_col else None)
        role_pts = _dec(first_row[pts_col] if len(first_row) > pts_col else None)
        if role_name and role_pts > 0:
            WorkloadItem.objects.create(
                report=report,
                category='ASSIGNED_ROLE',
                description=role_name,
                allocated_hours=role_pts * POINT_TO_HOURS,
            )
