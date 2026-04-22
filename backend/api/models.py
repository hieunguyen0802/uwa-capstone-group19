import uuid
from django.db import models
from django.contrib.auth.models import User
from django.core.validators import MinValueValidator
from decimal import Decimal


class Department(models.Model):
    department_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    hod = models.ForeignKey(
        'Staff',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_department'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'departments'
        indexes = [models.Index(fields=['name'])]

    def __str__(self):
        return self.name


class Staff(models.Model):
    staff_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    staff_number = models.CharField(max_length=8, unique=True, help_text="8-digit UWA staff number")
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='staff_profile')

    ROLE_CHOICES = [
        ('ACADEMIC', 'Academic Staff'),
        ('HOD', 'Head of Department'),
        ('SCHOOL_OPS', 'School Operations'),
        ('HOS', 'Head of School'),
    ]
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)

    department = models.ForeignKey(
        Department,
        on_delete=models.PROTECT,
        related_name='staff_members'
    )

    fte = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=Decimal('1.00'),
        validators=[MinValueValidator(Decimal('0.00'))]
    )

    EMPLOYMENT_CHOICES = [
        ('FULL_TIME', 'Full-time'),
        ('PART_TIME', 'Part-time'),
        ('CASUAL', 'Casual'),
    ]
    employment_type = models.CharField(max_length=20, choices=EMPLOYMENT_CHOICES, default='FULL_TIME')

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'staff'
        indexes = [
            models.Index(fields=['department', 'role']),
            models.Index(fields=['staff_number']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f"{self.staff_number} - {self.user.get_full_name()} ({self.role})"


class WorkloadReport(models.Model):
    report_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name='workload_reports')

    academic_year = models.IntegerField()
    SEMESTER_CHOICES = [
        ('S1', 'Semester 1'),
        ('S2', 'Semester 2'),
        ('FULL_YEAR', 'Full Year'),
    ]
    semester = models.CharField(max_length=10, choices=SEMESTER_CHOICES)

    snapshot_fte = models.DecimalField(max_digits=4, decimal_places=2)
    snapshot_department = models.ForeignKey(
        Department,
        on_delete=models.PROTECT,
        related_name='historical_reports'
    )

    STATUS_CHOICES = [
        ('PENDING', 'Pending Review'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('ACTIONED', 'Actioned'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')

    is_anomaly = models.BooleanField(default=False)

    # Reimport tracking fields
    import_batch_id = models.UUIDField(default=uuid.uuid4)
    is_current = models.BooleanField(default=True)
    superseded_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='supersedes'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workload_reports'
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['is_anomaly']),
            models.Index(fields=['academic_year', 'semester']),
            models.Index(fields=['import_batch_id']),
            models.Index(fields=['is_current']),
        ]

    def __str__(self):
        return f"{self.staff.staff_number} - {self.academic_year} {self.semester}"


class WorkloadItem(models.Model):
    item_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    report = models.ForeignKey(WorkloadReport, on_delete=models.CASCADE, related_name='items')

    # RESEARCH is excluded: it is a remainder, not stored in DB
    CATEGORY_CHOICES = [
        ('TEACHING', 'Teaching'),
        ('SERVICE', 'Service'),
        ('ASSIGNED_ROLE', 'Assigned Role'),
        ('HDR_SUPERVISION', 'HDR Supervision'),
    ]
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)

    unit_code = models.CharField(max_length=20, blank=True, null=True)
    description = models.TextField(blank=True, null=True)

    allocated_hours = models.DecimalField(
        max_digits=7,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.00'))]
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'workload_items'
        indexes = [models.Index(fields=['report', 'category'])]

    def __str__(self):
        return f"{self.category} - {self.allocated_hours}h"


class AuditLog(models.Model):
    log_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    report = models.ForeignKey(
        WorkloadReport,
        on_delete=models.PROTECT,
        related_name='audit_logs',
        null=True,
        blank=True
    )

    action_by = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, related_name='actions')

    ACTION_CHOICES = [
        ('IMPORTED', 'Imported from Excel'),
        ('MODIFIED_BY_REIMPORT', 'Modified by Re-import'),
        ('APPROVE', 'Approved'),
        ('REJECT', 'Rejected'),
        ('COMMENT', 'Added Comment'),
        ('CONFIG_CHANGE', 'System Config Changed'),
    ]
    action_type = models.CharField(max_length=25, choices=ACTION_CHOICES)

    comment = models.TextField(blank=True, null=True)
    changes = models.JSONField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'audit_logs'
        indexes = [
            models.Index(fields=['report', '-created_at']),
            models.Index(fields=['action_by', '-created_at']),
            models.Index(fields=['action_type', '-created_at']),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.action_type} by {self.action_by} at {self.created_at}"


class SystemConfig(models.Model):
    config_key = models.CharField(max_length=100, primary_key=True)
    config_value = models.CharField(max_length=255)

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
