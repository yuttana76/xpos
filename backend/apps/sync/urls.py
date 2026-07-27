from django.urls import path

from .views import SyncOrdersPushView, SyncPullView

urlpatterns = [
    path("pull/", SyncPullView.as_view(), name="sync-pull"),
    path("orders/push/", SyncOrdersPushView.as_view(), name="sync-orders-push"),
]
