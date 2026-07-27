from rest_framework.routers import DefaultRouter

from .views import TableViewSet, ZoneViewSet

router = DefaultRouter()
router.register("zones", ZoneViewSet, basename="zone")
router.register("tables", TableViewSet, basename="table")

urlpatterns = router.urls
