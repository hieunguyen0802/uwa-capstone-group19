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
]
