from django.urls import path
from api.view.auth_views import login_view
from api.view.supervisor_views import (
    supervisor_requests,
    create_workload,
    approve_request,
    reject_request,
    get_my_workloads,
    get_pending_requests,
    action_request,
)
from api.view.academic_views import (
    get_my_workloads as academic_get_my_workloads,
    submit_request,
)

urlpatterns = [
    # Auth
    path('login/', login_view),

    # Supervisor APIs
    path('supervisor/requests/', supervisor_requests),          # All workloads grouped by status
    path('supervisor/create/', create_workload),                # Create a new workload record
    path('supervisor/approve/<int:id>/', approve_request),      # Directly approve a workload
    path('supervisor/reject/<int:id>/', reject_request),        # Directly reject a workload
    path('supervisor/list/', get_my_workloads),                 # Recent workload list
    path('supervisor/pending-requests/', get_pending_requests),             # Academic-submitted requests awaiting review
    path('supervisor/action-request/<int:request_id>/', action_request),    # Close a request case

    # Academic APIs
    path('academic/my-workloads/', academic_get_my_workloads),  # View own workload records
    path('academic/submit-request/', submit_request),           # Submit approve or reject decision
]
