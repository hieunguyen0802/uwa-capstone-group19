from django.urls import path
from .view.auth_views import login_view

urlpatterns = [
    path('login/', login_view),
]