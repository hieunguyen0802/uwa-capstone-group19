from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0009_staff_permissions'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='staff',
            options={
                'permissions': [
                    ('view_academic_page', 'Can view Academic page'),
                    ('view_hod_page', 'Can view HoD page'),
                    ('view_school_ops_page', 'Can view School Operations page'),
                    ('view_hos_page', 'Can view Head of School page'),
                    ('access_school_ops_api', 'Can access School Operations API'),
                    ('approve_workload_dept', 'Can approve workload at department level'),
                    ('approve_workload_school', 'Can approve workload at school level'),
                    ('import_workload', 'Can import workload Excel'),
                    ('manage_staff', 'Can create or edit staff records'),
                ],
            },
        ),
    ]
