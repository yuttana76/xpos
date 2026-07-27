from rest_framework.routers import DefaultRouter

from .views import CategoryViewSet, KitchenPrinterViewSet, MenuItemViewSet

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("items", MenuItemViewSet, basename="menu-item")
router.register("kitchen-printers", KitchenPrinterViewSet, basename="kitchen-printer")

urlpatterns = router.urls
