from django.urls import path
from api.view.auth_views import login_view
from api.view.supervisor_views import (
    supervisor_requests,
    create_workload,
    approve_request,
    reject_request,
    get_my_workloads
)

urlpatterns = [
    path('login/', login_view),

    path('supervisor/requests/', supervisor_requests),
    path('supervisor/create/', create_workload),
    path('supervisor/approve/<int:id>/', approve_request),
    path('supervisor/reject/<int:id>/', reject_request),
    path('supervisor/list/', get_my_workloads),
]