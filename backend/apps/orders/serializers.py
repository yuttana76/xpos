from rest_framework import serializers

from .models import Order, OrderItem, OrderItemModifier


class OrderItemModifierSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItemModifier
        fields = ["id", "modifier_option", "extra_price"]


class OrderItemSerializer(serializers.ModelSerializer):
    selected_modifiers = OrderItemModifierSerializer(many=True, read_only=True)

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "menu_item",
            "quantity",
            "unit_price",
            "notes",
            "kitchen_status",
            "channel",
            "added_by",
            "is_takeaway",
            "selected_modifiers",
            "updated_at",
        ]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id",
            "store",
            "device_id",
            "receipt_number",
            "order_type",
            "table",
            "customer_name",
            "customer_phone",
            "opened_by",
            "paid_by",
            "status",
            "session_token",
            "subtotal",
            "discount",
            "tax_amount",
            "service_charge",
            "total_amount",
            "payment_method",
            "created_at",
            "updated_at",
            "items",
        ]
