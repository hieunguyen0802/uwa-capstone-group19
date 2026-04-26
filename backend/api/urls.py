from django.urls import path
from api.view.auth_views import login_view
from api.view.supervisor_views import (
    supervisor_requests,
    approve_request,
    reject_request,
    get_my_workloads as supervisor_get_my_workloads,
    get_pending_requests,
)
from api.view.academic_views import (
    get_my_workloads,
    submit_query,
)
from api.view.hod_views import (
    get_pending_queries,
    approve_query,
    reject_query,
)
from api.view.hos_views import (
    get_hod_summary,
    hos_approve,
    hos_reject,
)
from api.view.ops_views import import_excel

urlpatterns = [
    # Auth
    path('login/', login_view),

    # Supervisor / Manager APIs (legacy routes kept for backward compat)
    path('supervisor/requests/', supervisor_requests),
    path('supervisor/approve/<str:id>/', approve_request),
    path('supervisor/reject/<str:id>/', reject_request),
    path('supervisor/list/', supervisor_get_my_workloads),
    path('supervisor/pending-requests/', get_pending_requests),

    # Academic APIs
    path('workloads/my/', get_my_workloads),
    path('queries/', submit_query),

    # HOD query approval APIs (#4)
    path('queries/pending/', get_pending_queries),
    path('queries/<str:id>/approve/', approve_query),
    path('queries/<str:id>/reject/', reject_query),

    # HOS approval of HOD workload (#5)
    path('workloads/hod-summary/', get_hod_summary),
    path('workloads/<str:id>/hos-approve/', hos_approve),
    path('workloads/<str:id>/hos-reject/', hos_reject),

    # SCHOOL_OPS Excel import (#6)
    path('ops/import/', import_excel),
]
