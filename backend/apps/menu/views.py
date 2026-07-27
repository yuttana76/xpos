from rest_framework.exceptions import ValidationError

from apps.common.permissions import IsOwner
from apps.common.viewsets import SoftDeleteModelViewSet

from .models import Category, KitchenPrinter, MenuItem
from .serializers import CategorySerializer, KitchenPrinterSerializer, MenuItemSerializer


class KitchenPrinterViewSet(SoftDeleteModelViewSet):
    """CRUD เครื่องพิมพ์ครัวของร้าน — เฉพาะ OWNER"""

    permission_classes = [IsOwner]
    serializer_class = KitchenPrinterSerializer

    def get_queryset(self):
        return KitchenPrinter.objects.filter(store_id=self.request.user.store_id).order_by("name")

    def perform_create(self, serializer):
        serializer.save(store_id=self.request.user.store_id)


class CategoryViewSet(SoftDeleteModelViewSet):
    """CRUD หมวดหมู่เมนูของร้าน — เฉพาะ OWNER"""

    permission_classes = [IsOwner]
    serializer_class = CategorySerializer

    def get_queryset(self):
        return Category.objects.filter(store_id=self.request.user.store_id).order_by("name")

    def perform_create(self, serializer):
        printer = serializer.validated_data.get("kitchen_printer")
        if printer and str(printer.store_id) != str(self.request.user.store_id):
            raise ValidationError({"kitchen_printer": "เครื่องพิมพ์นี้ไม่ได้อยู่ในร้านของคุณ"})
        serializer.save(store_id=self.request.user.store_id)

    def perform_update(self, serializer):
        printer = serializer.validated_data.get("kitchen_printer")
        if printer and str(printer.store_id) != str(self.request.user.store_id):
            raise ValidationError({"kitchen_printer": "เครื่องพิมพ์นี้ไม่ได้อยู่ในร้านของคุณ"})
        serializer.save()


class MenuItemViewSet(SoftDeleteModelViewSet):
    """CRUD เมนูอาหารของร้าน — เฉพาะ OWNER"""

    permission_classes = [IsOwner]
    serializer_class = MenuItemSerializer

    def get_queryset(self):
        return MenuItem.objects.filter(store_id=self.request.user.store_id).order_by("name")

    def perform_create(self, serializer):
        category = serializer.validated_data["category"]
        if str(category.store_id) != str(self.request.user.store_id):
            raise ValidationError({"category": "หมวดหมู่นี้ไม่ได้อยู่ในร้านของคุณ"})
        serializer.save(store_id=self.request.user.store_id)

    def perform_update(self, serializer):
        category = serializer.validated_data.get("category", serializer.instance.category)
        if str(category.store_id) != str(self.request.user.store_id):
            raise ValidationError({"category": "หมวดหมู่นี้ไม่ได้อยู่ในร้านของคุณ"})
        # bump version ทุกครั้งที่แก้ไข ใช้เป็น cache-busting hint ฝั่ง client (rule เดิมของ MenuItem.version)
        serializer.save(version=serializer.instance.version + 1)
