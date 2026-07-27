from django.urls import path

from .public_views import SelfOrderMenuView, SelfOrderSubmitItemsView

urlpatterns = [
    path(
        "<str:session_token>/menu/",
        SelfOrderMenuView.as_view(),
        name="self-order-menu",
    ),
    path(
        "<str:session_token>/items/",
        SelfOrderSubmitItemsView.as_view(),
        name="self-order-items",
    ),
]
