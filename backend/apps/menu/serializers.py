from rest_framework import serializers

from .models import Category, KitchenPrinter, MenuItem


class KitchenPrinterSerializer(serializers.ModelSerializer):
    class Meta:
        model = KitchenPrinter
        fields = ["id", "name", "ip_address", "is_active", "updated_at"]
        read_only_fields = ["id", "updated_at"]


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "kitchen_printer", "is_active", "updated_at"]
        read_only_fields = ["id", "updated_at"]


class MenuItemSerializer(serializers.ModelSerializer):
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
        read_only_fields = ["id", "version", "updated_at"]
