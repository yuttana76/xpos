from django.contrib import admin

from .models import Store


@admin.register(Store)
class StoreAdmin(admin.ModelAdmin):
    list_display = ("name", "store_code", "tax_id", "vat_rate", "service_charge_rate", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "store_code", "tax_id")
