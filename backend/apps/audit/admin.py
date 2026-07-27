from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "store", "staff", "action", "target_model", "target_id")
    list_filter = ("store", "action")
    search_fields = ("target_id",)
    readonly_fields = [f.name for f in AuditLog._meta.fields]  # บังคับอ่านอย่างเดียวแม้ใน admin

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
