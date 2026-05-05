import uuid
from django.db import models
from django.contrib.auth.models import User
from django.core.validators import MinValueValidator
from decimal import Decimal


class Department(models.Model):
    """
    Stores academic departments (e.g. "Computer Science & Software Engineering").

    Every Staff member must belong to a Department.
    HOD can only see data from their own Department — data isolation is enforced
    by filtering on this FK at query time.
    """

    # UUID primary key instead of auto-increment integer.
    # Reason: UUIDs don't leak record counts and are safe to expose in URLs.
    department_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Department name must be globally unique — no two departments share a name.
    name = models.CharField(max_length=100, unique=True)

    # Which Staff member is the HOD of this department.
    # String 'Staff' (not the class directly) because Staff is defined below this class —
    # Python reads top-to-bottom, so the class doesn't exist yet at this point.
    # SET_NULL: if that Staff record is deleted, this field becomes NULL rather than
    # cascading and deleting the whole department.
    hod = models.ForeignKey(
        'Staff',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_department'  # reverse: staff_obj.managed_department.all()
    )

    # Automatically set to now() on INSERT, never updated after that.
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'departments'  # actual PostgreSQL table name (default would be "api_department")
        indexes = [models.Index(fields=['name'])]  # speeds up lookups by department name

    def __str__(self):
        return self.name


class Staff(models.Model):
    """
    Extends Django's built-in User model with business fields.

    Django's built-in User only has: username, password, email, first_name, last_name.
    We need: staff number, role, department, FTE, employment type — so we extend it
    via a OneToOneField rather than modifying the built-in model.

    Java equivalent: like combining Spring Security's UserDetails with a business
    Employee entity. Django convention is to keep the built-in User and link a
    separate profile table via OneToOne.

    Usage:
        staff = Staff.objects.get(user=request.user)  # get staff from logged-in user
        staff.role          # 'ACADEMIC'
        staff.fte           # Decimal('1.00')
        staff.department.name  # 'Computer Science'
    """

    staff_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # 8-digit UWA staff number (e.g. "12345678").
    # Used as the natural key when matching Excel rows to Staff records during import.
    staff_number = models.CharField(max_length=8, unique=True)

    # Link to Django's built-in User (holds username / password / email).
    # OneToOne: one User → one Staff, one Staff → one User.
    # CASCADE: deleting the User also deletes this Staff record.
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='staff_profile')

    # Role controls what the user can see and do:
    #   ACADEMIC    — views own workload, submits approve/reject
    #   HOD         — views all staff in their department, makes final approval
    #   SCHOOL_OPS  — Daniela's role; uploads Excel, views everyone
    #   HOS         — Head of School; views everyone, top-level approval
    ROLE_CHOICES = [
        ('ACADEMIC', 'Academic Staff'),
        ('HOD', 'Head of Department'),
        ('SCHOOL_OPS', 'School Operations'),
        ('HOS', 'Head of School'),
    ]
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)

    # PROTECT: prevents deleting a Department that still has Staff members.
    department = models.ForeignKey(
        Department,
        on_delete=models.PROTECT,
        related_name='staff_members'  # reverse: dept.staff_members.all()
    )

    # Full-Time Equivalent. 1.0 = full-time, 0.5 = half-time.
    # Business rule: FTE × 100 = total annual workload points for this staff member.
    # e.g. FTE=0.5 → 50 pts = 862.5 hours/year.
    fte = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=Decimal('1.00'),
        validators=[MinValueValidator(Decimal('0.00'))]  # FTE cannot be negative
    )

    # Used to identify Casual staff for separate reporting (pending Daniela Q5 confirmation).
    EMPLOYMENT_CHOICES = [
        ('FULL_TIME', 'Full-time'),
        ('PART_TIME', 'Part-time'),
        ('CASUAL', 'Casual'),
    ]
    employment_type = models.CharField(max_length=20, choices=EMPLOYMENT_CHOICES, default='FULL_TIME')

    # Soft-delete flag. Set to False for departed staff instead of deleting the row,
    # so historical workload records remain intact.
    is_active = models.BooleanField(default=True)

    # Academic title (e.g. "Lecturer", "Associate Professor") — display only, not used for RBAC.
    title = models.CharField(max_length=100, blank=True, default='')

    # True for staff in their first year; affects workload band calculation.
    is_new_employee = models.BooleanField(default=False)

    # Free-text notes visible to School Ops only.
    notes = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)  # auto-updated on every save()

    class Meta:
        db_table = 'staff'
        indexes = [
            models.Index(fields=['department', 'role']),  # HOD querying staff in their department
            models.Index(fields=['staff_number']),         # Excel import: match row to staff record
            models.Index(fields=['is_active']),            # filter active staff
        ]

    def __str__(self):
        return f"{self.staff_number} - {self.user.get_full_name()} ({self.role})"


class WorkloadReport(models.Model):
    """
    One workload report per staff member per semester. This is the core object
    of the approval workflow.

    Data flow:
        Daniela uploads Excel
            → system creates one WorkloadReport per staff (status=PENDING)
            → system creates WorkloadItems for each unit/activity row
            → Academic reviews and submits approve/reject
            → HOD makes final approval decision
            → every step is recorded in AuditLog

    Java equivalent: like an Order entity, where WorkloadItem = OrderItem
    and AuditLog = OrderHistory.
    """

    report_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name='workload_reports')

    academic_year = models.IntegerField()  # e.g. 2025
    SEMESTER_CHOICES = [
        ('S1', 'Semester 1'),
        ('S2', 'Semester 2'),
        ('FULL_YEAR', 'Full Year'),
    ]
    semester = models.CharField(max_length=10, choices=SEMESTER_CHOICES)

    # Snapshot fields: copy the staff's FTE and department at import time.
    # Reason: if the staff member later changes department or FTE, historical
    # reports must reflect what was true at the time of import, not the current value.
    snapshot_fte = models.DecimalField(max_digits=4, decimal_places=2)
    snapshot_department = models.ForeignKey(
        Department,
        on_delete=models.PROTECT,
        related_name='historical_reports'
    )

    # Status lifecycle: INITIAL → PENDING → APPROVED or REJECTED
    # INITIAL:  Daniela imported; academic can see, HOD can see but cannot act.
    # PENDING:  Academic submitted request; HOD can approve or reject.
    # APPROVED / REJECTED: terminal states set by HOD.
    STATUS_CHOICES = [
        ('INITIAL', 'Initial'),
        ('PENDING', 'Pending Review'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='INITIAL')

    # Set to True at import time if the staff member's T:R ratio does not match
    # their contract type (e.g. contract says T&R 50/50 but actual teaching is 90%).
    is_anomaly = models.BooleanField(default=False)

    # ── Re-import tracking fields ─────────────────────────────────────────────
    #
    # Problem: Daniela finds that Cai's data was entered incorrectly and re-uploads
    # a corrected Excel. We must update only Cai's record without touching Li's
    # record which may already be mid-approval.
    #
    # Solution:
    #   1. New import generates a fresh import_batch_id (UUID).
    #   2. Find Cai's existing report → set is_current=False, superseded_by=new report.
    #   3. Write an AuditLog entry with action_type='MODIFIED_BY_REIMPORT'.
    #   4. Li's report is untouched because her staff_number wasn't in the new file.
    #
    # Query current valid records:  WorkloadReport.objects.filter(is_current=True)
    # Query one import batch:       WorkloadReport.objects.filter(import_batch_id=some_uuid)

    # All records created in the same upload share this UUID.
    import_batch_id = models.UUIDField(default=uuid.uuid4)

    # True = this is the active version of the record.
    # False = superseded by a re-import; kept for audit history only.
    is_current = models.BooleanField(default=True)

    # Points to the newer record that replaced this one. NULL means not yet superseded.
    # 'self' = self-referential FK (foreign key pointing to the same table).
    superseded_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='supersedes'  # reverse: new_report.supersedes.all() → old reports it replaced
    )
    # ─────────────────────────────────────────────────────────────────────────

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workload_reports'
        indexes = [
            models.Index(fields=['status']),                    # filter all PENDING reports
            models.Index(fields=['is_anomaly']),                # filter anomalous reports
            models.Index(fields=['academic_year', 'semester']), # query by year + semester
            models.Index(fields=['import_batch_id']),           # query all records from one import
            models.Index(fields=['is_current']),                # filter active records
        ]

    def __str__(self):
        return f"{self.staff.staff_number} - {self.academic_year} {self.semester}"


class WorkloadItem(models.Model):
    """
    Detail rows under a WorkloadReport. One row per unit/activity.
    Relationship: WorkloadReport 1 → N WorkloadItem.

    Example: a staff member's S1 WorkloadReport might have these items:
        WorkloadItem(category='TEACHING',        unit_code='CITS5206', allocated_hours=86.25)
        WorkloadItem(category='TEACHING',        unit_code='CITS3200', allocated_hours=43.125)
        WorkloadItem(category='HDR_SUPERVISION', unit_code=None,       allocated_hours=86.25)
        WorkloadItem(category='ASSIGNED_ROLE',   unit_code=None,       allocated_hours=34.5)
        WorkloadItem(category='SERVICE',         unit_code=None,       allocated_hours=172.5)

    Note: there is NO 'RESEARCH' category.
    Research is a remainder, calculated on the fly — never stored:
        research_pts = staff.fte * 100 - teaching_pts - hdr_pts - role_pts - service_pts
    """

    item_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # CASCADE: deleting the parent WorkloadReport also deletes all its items.
    report = models.ForeignKey(WorkloadReport, on_delete=models.CASCADE, related_name='items')

    # Activity category. RESEARCH is intentionally excluded — see class docstring.
    CATEGORY_CHOICES = [
        ('TEACHING', 'Teaching'),               # lectures, labs, etc. (hours already scaled)
        ('SERVICE', 'Service'),                 # Self-Directed Service = FTE × 10, auto-calculated
        ('ASSIGNED_ROLE', 'Assigned Role'),     # committee roles etc., entered as points directly
        ('HDR_SUPERVISION', 'HDR Supervision'), # PhD supervision: full-time=5pts, part-time=2.5pts
    ]
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)

    # Unit code only applies to TEACHING rows (e.g. 'CITS5206'). Null for all other categories.
    unit_code = models.CharField(max_length=20, blank=True, null=True)
    description = models.TextField(blank=True, null=True)

    # Hours already scaled by contact-hour ratios (e.g. new lecture: 1 contact hr × 4 = 4 hrs).
    # Daniela applies the scaling before entering data into the template (pending confirmation).
    allocated_hours = models.DecimalField(
        max_digits=7,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.00'))]  # hours cannot be negative
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'workload_items'
        indexes = [models.Index(fields=['report', 'category'])]  # e.g. get all TEACHING items for a report

    def __str__(self):
        return f"{self.category} - {self.allocated_hours}h"


class AuditLog(models.Model):
    """
    Immutable audit trail. Records every operation in the system.
    Rows can only be inserted — never updated or deleted.

    Why this exists:
        - Compliance: who did what and when must be traceable
        - Re-import traceability: which old record was replaced, by whom, when
        - Approval chain: every approve/reject decision is permanently recorded

    Difference from the old Request model:
        The old Request only captured the Academic's approve/reject action.
        AuditLog covers all operations: import, re-import, approval, rejection,
        comments, and config changes — a complete, tamper-evident audit chain.

    on_delete=PROTECT on the report FK:
        If a WorkloadReport has associated AuditLog entries, Django will refuse
        to delete that report. This is intentional — audit evidence must not be
        destroyed by deleting the parent record.
    """

    log_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Which report this log entry relates to.
    # null=True allows logging system-level actions not tied to a specific report
    # (e.g. CONFIG_CHANGE).
    report = models.ForeignKey(
        WorkloadReport,
        on_delete=models.PROTECT,  # critical: prevents deleting a report that has audit history
        related_name='audit_logs',
        null=True,
        blank=True
    )

    # Who performed the action. SET_NULL: if the Staff account is deleted, the log
    # entry is preserved with action_by=NULL rather than being deleted.
    action_by = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, related_name='actions')

    # What happened:
    #   IMPORTED            — Daniela uploaded Excel; new WorkloadReport created
    #   MODIFIED_BY_REIMPORT — Daniela re-uploaded; old record superseded by new one
    #   APPROVE             — HOD / SCHOOL_OPS / HOS approved the report
    #   REJECT              — HOD / SCHOOL_OPS / HOS rejected the report
    #   COMMENT             — any role added a comment
    #   CONFIG_CHANGE       — someone changed a SystemConfig value (e.g. TR_TOLERANCE)
    ACTION_CHOICES = [
        ('IMPORTED', 'Imported from Excel'),
        ('MODIFIED_BY_REIMPORT', 'Modified by Re-import'),
        ('APPROVE', 'Approved'),
        ('REJECT', 'Rejected'),
        ('COMMENT', 'Added Comment'),
        ('CONFIG_CHANGE', 'System Config Changed'),
    ]
    action_type = models.CharField(max_length=25, choices=ACTION_CHOICES)

    comment = models.TextField(blank=True, null=True)  # e.g. reason provided when rejecting

    # JSONB field storing before/after snapshots of changed data.
    # Example: {"before": {"status": "PENDING"}, "after": {"status": "APPROVED"}}
    # Allows reconstructing what the data looked like at any point in time.
    changes = models.JSONField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'audit_logs'
        indexes = [
            models.Index(fields=['report', '-created_at']),      # history for a specific report, newest first
            models.Index(fields=['action_by', '-created_at']),   # all actions by a specific staff member
            models.Index(fields=['action_type', '-created_at']), # filter by action type
        ]
        ordering = ['-created_at']  # default sort: newest log entry first

    def __str__(self):
        return f"{self.action_type} by {self.action_by} at {self.created_at}"


class SystemConfig(models.Model):
    """
    Global configuration parameters stored in the database.
    Allows business rules to be adjusted without redeploying code.

    Example: if Daniela says "a T:R difference within 5% should not be flagged",
    update TR_TOLERANCE from "0" to "0.05" in the database — no code change needed.

    Current parameters:
        TR_TOLERANCE = "0"  (exact match required; pending Daniela Q3 confirmation)

    Usage:
        config = SystemConfig.objects.get(config_key='TR_TOLERANCE')
        tolerance = float(config.config_value)  # 0.0
    """

    # Primary key is the parameter name string — more readable than an integer ID.
    config_key = models.CharField(max_length=100, primary_key=True)

    # All values stored as strings; caller converts using value_type.
    config_value = models.CharField(max_length=255)

    # Declares the intended type so save() can validate the format before writing.
    VALUE_TYPE_CHOICES = [
        ('INT', 'Integer'),
        ('FLOAT', 'Float'),
        ('STR', 'String'),
        ('BOOL', 'Boolean'),
    ]
    value_type = models.CharField(max_length=10, choices=VALUE_TYPE_CHOICES, default='STR')
    description = models.TextField(blank=True)

    updated_by = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'system_configs'

    def __str__(self):
        return f"{self.config_key} = {self.config_value}"

    def save(self, *args, **kwargs):
        # Validate that config_value matches the declared value_type before writing.
        # Prevents storing "abc" in a FLOAT parameter, which would crash at read time.
        if self.value_type == 'INT':
            try:
                int(self.config_value)
            except ValueError:
                raise ValueError(f"Invalid INT value: {self.config_value}")
        elif self.value_type == 'FLOAT':
            try:
                float(self.config_value)
            except ValueError:
                raise ValueError(f"Invalid FLOAT value: {self.config_value}")
        elif self.value_type == 'BOOL':
            if self.config_value.lower() not in ['true', 'false', '1', '0']:
                raise ValueError(f"Invalid BOOL value: {self.config_value}")
        super().save(*args, **kwargs)


class WorkloadDistributionJob(models.Model):
    """
    Records a school-level “distribute workload” action initiated from /admin.

    This does not mutate WorkloadReport rows by itself — it creates an audit trail
    placeholder so ops can correlate UI actions later when real distribution rules exist.
    """

    job_id = models.BigAutoField(primary_key=True)
    academic_year = models.PositiveIntegerField()
    semester = models.CharField(max_length=10)  # S1/S2 only for admin workflow
    triggered_by = models.ForeignKey(
        Staff,
        on_delete=models.SET_NULL,
        null=True,
        related_name='distribution_jobs',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True, default='')

    class Meta:
        db_table = 'workload_distribution_jobs'
        indexes = [
            models.Index(fields=['academic_year', 'semester', '-created_at']),
        ]

    def __str__(self):
        return f"distribution {self.job_id}: {self.academic_year} {self.semester}"


class StaffRoleAssignment(models.Model):
    """
    Extra role grants for HoD / school Admin beyond the canonical Staff.role field.

    Contract field `role` from the frontend maps to ROLE_CHOICES string values stored here.
    """

    FRONT_ROLE_CHOICES = [
        ('HoD', 'HoD'),
        ('Admin', 'Admin'),
    ]

    assignment_id = models.BigAutoField(primary_key=True)
    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name='role_assignments')
    role_code = models.CharField(max_length=20, choices=FRONT_ROLE_CHOICES)

    # Text label from frontend (e.g. “Senior School Coordinator”) or real department name.
    department_scope = models.CharField(max_length=150)
    resolved_department = models.ForeignKey(
        Department,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='role_assignments',
        help_text='Populated when department_scope matches an existing Department.name',
    )

    permissions = models.JSONField(default=list, blank=True)

    STATUS_CHOICES = [
        ('active', 'active'),
        ('disabled', 'disabled'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    disable_reason = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'staff_role_assignments'
        indexes = [
            models.Index(fields=['staff', 'status']),
        ]

    def __str__(self):
        return f"{self.staff.staff_number} → {self.role_code} ({self.status})"
