from django.db import models
from django.contrib.auth.models import User


class Staff(models.Model):
    """
    Extends Django's built-in User model with a role field.
    One-to-one relationship ensures each user has exactly one staff profile.
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE)

    ROLE_CHOICES = (
        ('academic', 'Academic'),
        ('supervisor', 'Supervisor'),
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)

    def __str__(self):
        return self.user.username


class Workload(models.Model):
    """
    Represents a single workload record imported from Excel by a Supervisor.
    Status transitions: pending -> approved | rejected
    """
    SEMESTER_CHOICES = (
        ('S1', 'Semester 1'),
        ('S2', 'Semester 2'),
    )

    user = models.ForeignKey(User, on_delete=models.CASCADE)
    supervisor = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='assigned_workloads'
    )

    full_name = models.CharField(max_length=100, default="Unknown")
    unit = models.CharField(max_length=50)
    title = models.CharField(max_length=50)
    teaching_ratio = models.FloatField()
    research_ratio = models.FloatField()
    hours = models.IntegerField()  # TODO: change to DecimalField before production
    is_sent = models.BooleanField(default=True)
    semester = models.CharField(max_length=2, choices=SEMESTER_CHOICES)

    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    )
    status = models.CharField(max_length=20, default='pending', choices=STATUS_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            # Composite index to avoid full table scan when filtering by user + status.
            models.Index(fields=['user', 'status']),
        ]

    def __str__(self):
        return f"{self.full_name} - {self.unit} ({self.hours}h)"


class Request(models.Model):
    """
    Records an academic's approve/reject decision on a workload record.
    A supervisor then reviews the request and marks it approved or rejected.
    """
    workload = models.ForeignKey(Workload, on_delete=models.CASCADE, related_name='requests')

    ACTION_CHOICES = (
        ('approve', 'Approve'),
        ('reject', 'Reject'),
    )
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    comment = models.TextField(blank=True, null=True)

    STATUS_CHOICES = (
        ('pending', 'Pending Supervisor Review'),
        ('approved', 'Approved by Supervisor'),
        ('rejected', 'Rejected by Supervisor'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Request #{self.id} - {self.action} ({self.status})"
