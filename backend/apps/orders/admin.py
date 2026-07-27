from django.contrib import admin

from .models import Order, OrderItem, OrderItemModifier


class OrderItemModifierInline(admin.TabularInline):
    model = OrderItemModifier
    extra = 0


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    show_change_link = True


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        "receipt_number",
        "store",
        "order_type",
        "table",
        "status",
        "total_amount",
        "created_at",
    )
    list_filter = ("store", "order_type", "status")
    search_fields = ("receipt_number", "session_token", "customer_name", "customer_phone")
    readonly_fields = ("session_token",)
    inlines = [OrderItemInline]


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = ("menu_item", "order", "quantity", "kitchen_status", "channel", "is_takeaway")
    list_filter = ("kitchen_status", "channel", "is_takeaway")
    inlines = [OrderItemModifierInline]
