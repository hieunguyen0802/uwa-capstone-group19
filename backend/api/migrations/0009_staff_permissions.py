from django.db import migrations


class Migration(migrations.Migration):
    """Register Staff.Meta.permissions for the Django auth framework.

    These codenames are consumed by the Group setup in
    api/management/commands/initialize_rbac.py and by /api/auth/me/.
    """

    dependencies = [
        ('api', '0008_merge_20260506_0000'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='staff',
            options={
                'permissions': [
                    ('view_academic_page',      'Can view Academic page'),
                    ('view_hod_page',           'Can view HoD page'),
                    ('view_school_ops_page',    'Can view School Operations page'),
                    ('view_hos_page',           'Can view Head of School page'),
                    ('approve_workload_dept',   'Can approve workload at department level'),
                    ('approve_workload_school', 'Can approve workload at school level'),
                    ('import_workload',         'Can import workload Excel'),
                    ('manage_staff',            'Can create or edit staff records'),
                ],
            },
        ),
    ]
