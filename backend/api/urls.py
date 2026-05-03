from django.urls import path
from api.view.auth_views import login_view
from api.view.supervisor_views import (
    supervisor_requests,
    approve_request,
    reject_request,
    get_my_workloads as supervisor_workloads,
    get_pending_requests,
    supervisor_workload_requests,
    supervisor_workload_request_detail,
    supervisor_batch_decision,
    supervisor_single_decision,
    supervisor_visualization,
    supervisor_export,
)
from api.view.academic_views import (
    academic_workloads,
    academic_workload_detail,
    academic_confirm_workload,
    academic_submit_workload_requests,
    academic_visualization,
    academic_export,
    get_my_workloads,
    submit_query,
)
from api.view.ops_admin_views import (
    admin_workload_requests,
    admin_workload_request_detail,
    admin_batch_decision,
    admin_single_decision,
    admin_distribute_workloads,
    admin_workload_import_template,
    admin_workload_import_template_download,
    admin_workload_import,
    admin_staff_import_template,
    admin_staff_import_template_download,
    admin_staff_import,
    admin_staff_list,
    admin_staff_patch,
    admin_role_assignments,
    admin_role_assignment_disable,
    admin_visualization,
    admin_export_manifest,
    admin_export_download,
)

urlpatterns = [
    # Auth
    path('login/', login_view),

    # Supervisor — new contract (8.2–8.8)
    # batch-decision must come before <str:id>/ to avoid routing conflict
    path('supervisor/workload-requests/', supervisor_workload_requests),
    path('supervisor/workload-requests/batch-decision/', supervisor_batch_decision),
    path('supervisor/workload-requests/<str:id>/', supervisor_workload_request_detail),
    path('supervisor/workload-requests/<str:id>/decision/', supervisor_single_decision),
    path('supervisor/visualization/', supervisor_visualization),
    path('supervisor/export/', supervisor_export),

    # Supervisor — legacy endpoints
    path('supervisor/requests/', supervisor_requests),
    path('supervisor/approve/<str:id>/', approve_request),
    path('supervisor/reject/<str:id>/', reject_request),
    path('supervisor/list/', supervisor_workloads),
    path('supervisor/pending-requests/', get_pending_requests),

    # Academic APIs (new contract)
    path('academic/workloads/', academic_workloads),
    path('academic/workloads/<str:id>/', academic_workload_detail),
    path('academic/workloads/<str:id>/confirm/', academic_confirm_workload),
    path('academic/workload-requests/', academic_submit_workload_requests),
    path('academic/visualization/', academic_visualization),
    path('academic/export/', academic_export),

    # Academic APIs (legacy compatibility)
    path('workloads/my/', get_my_workloads),
    path('queries/', submit_query),

    # School operations (/admin integration contract §10.x)
    path('admin/workload-requests/', admin_workload_requests),
    path('admin/workload-requests/batch-decision/', admin_batch_decision),
    path('admin/workload-requests/<str:id>/', admin_workload_request_detail),
    path('admin/workload-requests/<str:id>/decision/', admin_single_decision),
    path('admin/workloads/distribute/', admin_distribute_workloads),
    path('admin/workloads/import-template/', admin_workload_import_template),
    path('admin/workloads/import-template/download/', admin_workload_import_template_download),
    path('admin/workloads/import/', admin_workload_import),
    path('admin/staff/', admin_staff_list),
    path('admin/staff/<str:staff_id>/', admin_staff_patch),
    path('admin/staff/import-template/', admin_staff_import_template),
    path('admin/staff/import-template/download/', admin_staff_import_template_download),
    path('admin/staff/import/', admin_staff_import),
    path('admin/role-assignments/', admin_role_assignments),
    path('admin/role-assignments/<int:assignment_id>/disable/', admin_role_assignment_disable),
    path('admin/visualization/', admin_visualization),
    path('admin/export/', admin_export_manifest),
    path('admin/export/download/', admin_export_download),
]
