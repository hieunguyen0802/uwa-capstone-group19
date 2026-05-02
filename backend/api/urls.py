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
    # Auth — password-based (legacy, kept for admin/superuser use)
    path('login/', login_view),

    # Auth — OTP passwordless login
    path('login/request-otp/', otp_request_view),
    path('login/verify-otp/', otp_verify_view),

    # Import (SCHOOL_OPS only)
    path('import/workload/', import_workload_view),

    # Supervisor / Manager APIs
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
]
