from django.urls import path
from api.view.auth_views import login_view
from api.view.pageinfo_views import messages_view, profile_avatar, profile_me
from api.view.supervisor_views import (
    supervisor_requests,
    approve_request,
    reject_request,
    get_my_workloads as supervisor_list_workloads,
    get_pending_requests,
)
from api.view.academic_views import (
    get_my_workloads as academic_my_workloads,
    submit_query,
)

urlpatterns = [
    # Auth
    path('login/', login_view),

    # Shared profile + messages (contract §11)
    path('profile/me/', profile_me),
    path('profile/avatar/', profile_avatar),
    path('messages/', messages_view),
    path('supervisor/requests/', supervisor_requests),
    path('supervisor/approve/<str:id>/', approve_request),
    path('supervisor/reject/<str:id>/', reject_request),
    path('supervisor/list/', supervisor_list_workloads),
    path('supervisor/pending-requests/', get_pending_requests),

    # Academic APIs
    path('workloads/my/', academic_my_workloads),
    path('queries/', submit_query),
]
