from django.db import migrations, models
import django.db.models.deletion


def backfill_assigned_by(apps, schema_editor):
    WorkloadReport = apps.get_model('api', 'WorkloadReport')
    AuditLog = apps.get_model('api', 'AuditLog')

    imported_logs = (
        AuditLog.objects.filter(action_type__in=['IMPORTED', 'MODIFIED_BY_REIMPORT'])
        .exclude(action_by_id__isnull=True)
        .order_by('report_id', '-created_at')
    )

    latest_actor_by_report = {}
    for log in imported_logs.iterator():
        latest_actor_by_report.setdefault(log.report_id, log.action_by_id)

    for report in WorkloadReport.objects.filter(assigned_by_id__isnull=True).iterator():
        action_by_id = latest_actor_by_report.get(report.report_id)
        if action_by_id:
            report.assigned_by_id = action_by_id
            report.save(update_fields=['assigned_by'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0015_merge_20260510_0000'),
    ]

    operations = [
        migrations.AddField(
            model_name='workloadreport',
            name='assigned_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='assigned_workload_reports',
                to='api.staff',
            ),
        ),
        migrations.RunPython(backfill_assigned_by, migrations.RunPython.noop),
    ]
