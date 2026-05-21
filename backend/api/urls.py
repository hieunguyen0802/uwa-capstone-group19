from django.urls import path
from api.view.auth_views import login_view
from api.view.me_views import auth_me_view
from api.view.pageinfo_views import messages_view, profile_avatar, profile_me
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
    report_history,
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
from api.view.hod_views import (
    hod_semester_report_download,
    hod_semester_reports,
    hod_self_workload_requests,
    hod_workload_analytics,
    hod_workload_export,
    hod_workload_requests,
    hod_workload_request_detail,
    hod_workload_request_decision,
)
from api.view.hos_v3_views import (
    hos_semester_distribution_report_download,
    hos_semester_distribution_reports,
    hos_staff_directory,
    hos_staff_directory_import,
    hos_v3_role_assignments,
    hos_v3_role_assignment_status,
    hos_workload_analytics,
    hos_workload_export,
    hos_workload_requests,
    hos_workload_request_detail,
    hos_workload_request_decision,
)
from api.view.academic_views import (
    academic_semester_report_download,
    academic_semester_reports,
    academic_workloads,
    academic_workload_detail,
    academic_confirm_workload,
    academic_submit_workload_requests,
    academic_visualization,
    academic_export,
    academic_contact_school_ops,
    get_my_workloads,
    submit_query,
)
from api.view.ops_admin_views import (
    admin_workload_requests,
    admin_workload_request_detail,
    admin_workload_history,
    admin_batch_decision,
    admin_single_decision,
    admin_distribute_workloads,
    admin_distribution_progress,
    admin_redistribute_single_workload,
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
    admin_audit_log_export,
)

urlpatterns = [
    # Auth — password-based (legacy, kept for admin/superuser use)
    path('login/', login_view),
    path('auth/me/', auth_me_view),
    path('profile/me/', profile_me),
    path('profile/avatar/', profile_avatar),
    path('messages/', messages_view),


    # Auth — OTP passwordless login
    path('login/request-otp/', otp_request_view),
    path('login/verify-otp/', otp_verify_view),

    # Import (SCHOOL_OPS only)
    path('import/workload/', import_workload_view),

    # HoD APIs (v3, aligned to frontend contract `hod-hos-frontend-api.zh-en(1).md` §5)
    path('hod/workload-requests', hod_workload_requests),
    path('hod/workload-requests/', hod_workload_requests),
    path('hod/workload-requests/<str:id>', hod_workload_request_detail),
    path('hod/workload-requests/<str:id>/', hod_workload_request_detail),
    path('hod/workload-requests/<str:id>/decision', hod_workload_request_decision),
    path('hod/workload-requests/<str:id>/decision/', hod_workload_request_decision),
    path('hod/reports/semester', hod_semester_reports),
    path('hod/reports/semester/', hod_semester_reports),
    path('hod/reports/semester/<str:report_id>/download', hod_semester_report_download),
    path('hod/reports/semester/<str:report_id>/download/', hod_semester_report_download),
    path('hod/analytics/workloads', hod_workload_analytics),
    path('hod/analytics/workloads/', hod_workload_analytics),
    path('hod/exports/workloads', hod_workload_export),
    path('hod/exports/workloads/', hod_workload_export),
    path('hod/self-workload-requests', hod_self_workload_requests),
    path('hod/self-workload-requests/', hod_self_workload_requests),

    # HoS APIs (v3, §6) — school-wide scope, distinct from HoD department scope.
    path('hos/workload-requests', hos_workload_requests),
    path('hos/workload-requests/', hos_workload_requests),
    path('hos/workload-requests/<str:id>', hos_workload_request_detail),
    path('hos/workload-requests/<str:id>/', hos_workload_request_detail),
    path('hos/workload-requests/<str:id>/decision', hos_workload_request_decision),
    path('hos/workload-requests/<str:id>/decision/', hos_workload_request_decision),
    path('hos/reports/semester-distribution', hos_semester_distribution_reports),
    path('hos/reports/semester-distribution/', hos_semester_distribution_reports),
    path('hos/reports/semester-distribution/<str:report_id>/download', hos_semester_distribution_report_download),
    path('hos/reports/semester-distribution/<str:report_id>/download/', hos_semester_distribution_report_download),
    path('hos/staff-directory', hos_staff_directory),
    path('hos/staff-directory/', hos_staff_directory),
    path('hos/staff-directory/import', hos_staff_directory_import),
    path('hos/staff-directory/import/', hos_staff_directory_import),
    path('hos/role-assignments', hos_v3_role_assignments),
    path('hos/role-assignments/', hos_v3_role_assignments),
    path('hos/role-assignments/<int:assignment_id>/status', hos_v3_role_assignment_status),
    path('hos/role-assignments/<int:assignment_id>/status/', hos_v3_role_assignment_status),
    path('hos/analytics/workloads', hos_workload_analytics),
    path('hos/analytics/workloads/', hos_workload_analytics),
    path('hos/exports/workloads', hos_workload_export),
    path('hos/exports/workloads/', hos_workload_export),

    # Supervisor — new contract (8.2–8.8)
    # batch-decision must come before <str:id>/ to avoid routing conflict
    path('supervisor/workload-requests/', supervisor_workload_requests),
    path('supervisor/workload-requests/batch-decision/', supervisor_batch_decision),
    path('supervisor/workload-requests/<str:id>/', supervisor_workload_request_detail),
    path('supervisor/workload-requests/<str:id>/decision/', supervisor_single_decision),
    path('supervisor/visualization/', supervisor_visualization),
    path('supervisor/export/', supervisor_export),

    # Change history timeline — same endpoint serves ACADEMIC, HOD, SCHOOL_OPS, HOS
    # (visibility gate lives inside the view, not in the URL).
    path('reports/<str:id>/history/', report_history),

    # Supervisor — legacy endpoints
    path('supervisor/requests/', supervisor_requests),
    path('supervisor/approve/<str:id>/', approve_request),
    path('supervisor/reject/<str:id>/', reject_request),
    path('supervisor/list/', supervisor_workloads),
    path('supervisor/pending-requests/', get_pending_requests),


    # Academic APIs (v3 contract)
    path('academic/reports/semester', academic_semester_reports),
    path('academic/reports/semester/', academic_semester_reports),
    path('academic/reports/semester/<str:report_id>/download', academic_semester_report_download),
    path('academic/reports/semester/<str:report_id>/download/', academic_semester_report_download),

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
    path('academic/contact-school-of-operations/', academic_contact_school_ops),

    # Academic APIs (legacy compatibility)
    path('workloads/my/', get_my_workloads),
    path('queries/', submit_query),

    # School operations (/admin integration contract §10.x)
    path('admin/workload-requests/', admin_workload_requests),
    path('admin/workload-requests/batch-decision/', admin_batch_decision),
    path('admin/workload-requests/<str:id>/', admin_workload_request_detail),
    path('admin/workload-requests/<str:id>/decision/', admin_single_decision),
    path('admin/workloads/distribute/', admin_distribute_workloads),
    path('admin/workloads/distribute-progress/<str:progress_id>/', admin_distribution_progress),
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
    path('school-operations/workloads/distribute-progress/<str:progress_id>', admin_distribution_progress),
    path('school-operations/workloads/<str:id>/redistribute', admin_redistribute_single_workload),
    path('school-operations/workloads/export', admin_workload_export),
    path('school-operations/workloads/<str:id>/history', admin_workload_history),
    path('school-operations/workloads/<str:id>', admin_workload_request_detail),
    path('school-operations/workloads', admin_workload_requests),
    path('school-operations/staff/import', admin_staff_import),
    path('school-operations/staff/<str:staff_id>', admin_staff_patch),
    path('school-operations/staff', admin_staff_list),
    path('school-operations/visualization', admin_visualization),
    path('school-operations/export', admin_school_export),
    path('school-operations/audit-log/export', admin_audit_log_export),
    path('school-operations/contact-staff', admin_contact_staff),
]
