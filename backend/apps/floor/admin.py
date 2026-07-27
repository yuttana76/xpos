from django.contrib import admin

from .models import Table, Zone


@admin.register(Zone)
class ZoneAdmin(admin.ModelAdmin):
    list_display = ("name", "store", "is_active", "updated_at")
    list_filter = ("store", "is_active")


@admin.register(Table)
class TableAdmin(admin.ModelAdmin):
    list_display = ("name", "zone", "seats", "status", "is_active", "updated_at")
    list_filter = ("zone__store", "status", "is_active")
