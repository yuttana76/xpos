from django.urls import path

from .views import StoreProvisionPullView, SyncOrdersPushView, SyncPullView

urlpatterns = [
    path("pull/", SyncPullView.as_view(), name="sync-pull"),
    path("orders/push/", SyncOrdersPushView.as_view(), name="sync-orders-push"),
    path("store/pull/", StoreProvisionPullView.as_view(), name="sync-store-pull"),
]
