from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.staff.urls")),
    path("api/orders/", include("apps.orders.urls")),
    path("api/public/order-session/", include("apps.orders.public_urls")),
    path("api/public/store/", include("apps.tenancy.urls")),
    path("api/sync/", include("apps.sync.urls")),
    path("api/floor/", include("apps.floor.urls")),
    path("api/menu/", include("apps.menu.urls")),
    path("api/", include("apps.audit.urls")),
]
