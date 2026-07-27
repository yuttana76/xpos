from django.urls import path

from .views import PinLoginView

urlpatterns = [
    path("pin-login/", PinLoginView.as_view(), name="staff-pin-login"),
]
