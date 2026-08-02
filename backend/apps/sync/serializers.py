from rest_framework import serializers

from apps.floor.models import Table, Zone
from apps.menu.models import Category, KitchenPrinter, MenuItem, ModifierGroup, ModifierOption
from apps.staff.models import Staff
from apps.tenancy.models import Store


class ZoneSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = ["id", "name", "is_active", "updated_at"]


class TableSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = Table
        fields = ["id", "zone", "name", "seats", "status", "is_active", "updated_at"]


class KitchenPrinterSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = KitchenPrinter
        fields = ["id", "name", "ip_address", "is_active", "updated_at"]


class CategorySyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "kitchen_printer", "is_active", "updated_at"]


class MenuItemSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuItem
        fields = [
            "id",
            "category",
            "name",
            "price",
            "is_available",
            "is_active",
            "version",
            "updated_at",
        ]


class ModifierGroupSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModifierGroup
        fields = ["id", "name", "is_required", "is_active", "menu_items", "updated_at"]


class ModifierOptionSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModifierOption
        fields = ["id", "group", "name", "extra_price", "is_active", "updated_at"]


class StaffSyncSerializer(serializers.ModelSerializer):
    """เฉพาะ StoreProvisionPullView (StoreSync auth) เท่านั้น — ไม่ใช้กับ device pull ทั่วไป
    เพราะมี pin_code_hash ซึ่งไม่ควรหลุดไปที่ browser/IndexedDB"""

    class Meta:
        model = Staff
        fields = ["id", "name", "pin_code_hash", "role", "is_active", "updated_at"]


class StoreSettingsSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model = Store
        fields = [
            "id",
            "store_code",
            "name",
            "device_id",
            "tax_id",
            "address",
            "customer_order_base_url",
            "vat_rate",
            "service_charge_rate",
            "is_active",
            "updated_at",
        ]
