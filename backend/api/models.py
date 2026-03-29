from django.db import models
from django.contrib.auth.models import User

class Staff(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)

    ROLE_CHOICES = (
        ('academic', 'Academic'),
        ('supervisor', 'Supervisor'),
    )

    role = models.CharField(max_length=20, choices=ROLE_CHOICES)

    def __str__(self):
        return self.user.username

class Workload(models.Model):
    SEMESTER_CHOICES = (
        ('S1', 'Semester 1'),
        ('S2', 'Semester 2'),
    )

    user = models.ForeignKey(User, on_delete=models.CASCADE)
    supervisor = models.ForeignKey(User, on_delete=models.CASCADE, related_name='assigned_workloads')
    
    full_name = models.CharField(max_length=100, default="Unknown")    
    unit = models.CharField(max_length=50)
    title = models.CharField(max_length=50)
    teaching_ratio = models.FloatField()
    research_ratio = models.FloatField()
    hours = models.IntegerField()
    is_sent = models.BooleanField(default=True)

    semester = models.CharField(max_length=2, choices=SEMESTER_CHOICES)

    status = models.CharField(
        max_length=20,
        default='pending',
        choices=(
            ('pending', 'Pending'),
            ('approved', 'Approved'),
            ('rejected', 'Rejected'),
        )
    )

    created_at = models.DateTimeField(auto_now_add=True)