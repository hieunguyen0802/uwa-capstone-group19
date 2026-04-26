from django.urls import path
from api.view.auth_views import login_view
from api.view.supervisor_views import (
    supervisor_requests,
    approve_request,
    reject_request,
    get_my_workloads,
    get_pending_requests,
)
from api.view.academic_views import (
    get_my_workloads,
    submit_query,
)

urlpatterns = [
    # Auth
    path('login/', login_view),

    # Supervisor / Manager APIs
    path('supervisor/requests/', supervisor_requests),
    path('supervisor/approve/<str:id>/', approve_request),
    path('supervisor/reject/<str:id>/', reject_request),
    path('supervisor/list/', get_my_workloads),
    path('supervisor/pending-requests/', get_pending_requests),

    # Academic APIs
    path('workloads/my/', get_my_workloads),
    path('queries/', submit_query),
]
