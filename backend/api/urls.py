from django.urls import path
from api.view.auth_views import login_view
from api.view.otp_views import otp_request_view, otp_verify_view
from api.view.import_views import import_workload_view
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
from api.view.hos_views import (
    hos_staff_list,
    hos_staff_update,
    hos_staff_import_template,
    hos_staff_import,
    hos_role_assignments_collection,
    hos_disable_role_assignment,
    hos_visualization,
    hos_export,
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
    admin_workload_export,
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
    admin_school_export,
    admin_contact_staff,
)

urlpatterns = [
    # Auth — password-based (legacy, kept for admin/superuser use)
    path('login/', login_view),

    # Auth — OTP passwordless login
    path('login/request-otp/', otp_request_view),
    path('login/verify-otp/', otp_verify_view),

    # Import (SCHOOL_OPS only)
    path('import/workload/', import_workload_view),

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

    # Head of School APIs (9.2–9.12)
    path('headofschool/workload-requests/', supervisor_workload_requests),
    path('headofschool/workload-requests/batch-decision/', supervisor_batch_decision),
    path('headofschool/workload-requests/<str:id>/', supervisor_workload_request_detail),
    path('headofschool/workload-requests/<str:id>/decision/', supervisor_single_decision),
    path('headofschool/staff/', hos_staff_list),
    path('headofschool/staff/<str:staff_id>/', hos_staff_update),
    path('headofschool/staff/import-template/', hos_staff_import_template),
    path('headofschool/staff/import/', hos_staff_import),
    path('headofschool/role-assignments/', hos_role_assignments_collection),
    path('headofschool/role-assignments/<str:id>/disable/', hos_disable_role_assignment),
    path('headofschool/visualization/', hos_visualization),
    path('headofschool/export/', hos_export),

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
    # Literal paths must come before the parameterised catch-all to avoid shadowing.
    path('admin/staff/import-template/', admin_staff_import_template),
    path('admin/staff/import-template/download/', admin_staff_import_template_download),
    path('admin/staff/import/', admin_staff_import),
    path('admin/staff/<str:staff_id>/', admin_staff_patch),
    path('admin/role-assignments/', admin_role_assignments),
    path('admin/role-assignments/<int:assignment_id>/disable/', admin_role_assignment_disable),
    path('admin/visualization/', admin_visualization),
    path('admin/export/', admin_export_manifest),
    path('admin/export/download/', admin_export_download),

    # School Operations — new contract (/api/school-operations/*)
    # Literal paths before parameterised catch-alls to avoid shadowing (same lesson as /admin/staff/).
    path('school-operations/workloads/import', admin_workload_import),
    path('school-operations/workloads/distribute', admin_distribute_workloads),
    path('school-operations/workloads/export', admin_workload_export),
    path('school-operations/workloads/<str:id>', admin_workload_request_detail),
    path('school-operations/workloads', admin_workload_requests),
    path('school-operations/staff/import', admin_staff_import),
    path('school-operations/staff/<str:staff_id>', admin_staff_patch),
    path('school-operations/staff', admin_staff_list),
    path('school-operations/visualization', admin_visualization),
    path('school-operations/export', admin_school_export),
    path('school-operations/contact-staff', admin_contact_staff),
]
