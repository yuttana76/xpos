from django.contrib import admin

from .models import Category, KitchenPrinter, MenuItem, ModifierGroup, ModifierOption


@admin.register(KitchenPrinter)
class KitchenPrinterAdmin(admin.ModelAdmin):
    list_display = ("name", "store", "ip_address", "is_active", "updated_at")
    list_filter = ("store", "is_active")


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "store", "kitchen_printer", "is_active", "updated_at")
    list_filter = ("store", "is_active")


class ModifierOptionInline(admin.TabularInline):
    model = ModifierOption
    extra = 1


@admin.register(MenuItem)
class MenuItemAdmin(admin.ModelAdmin):
    list_display = ("name", "store", "category", "price", "is_available", "is_active", "updated_at")
    list_filter = ("store", "category", "is_available", "is_active")
    search_fields = ("name",)


@admin.register(ModifierGroup)
class ModifierGroupAdmin(admin.ModelAdmin):
    list_display = ("name", "store", "is_required", "is_active", "updated_at")
    list_filter = ("store", "is_required", "is_active")
    inlines = [ModifierOptionInline]


@admin.register(ModifierOption)
class ModifierOptionAdmin(admin.ModelAdmin):
    list_display = ("name", "group", "extra_price", "is_active", "updated_at")
    list_filter = ("group__store", "is_active")
