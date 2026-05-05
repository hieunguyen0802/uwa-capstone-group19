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
    academic_contact_school_ops,
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

    # Academic APIs (v3 contract)
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
]
