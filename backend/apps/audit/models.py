import uuid

from django.db import models

from apps.staff.models import Staff
from apps.tenancy.models import Store


class AuditLog(models.Model):
    class Action(models.TextChoices):
        ORDER_CANCELLED = "ORDER_CANCELLED", "ยกเลิกออเดอร์"
        ORDER_ITEM_VOIDED = "ORDER_ITEM_VOIDED", "ลบรายการอาหารหลังส่งครัวแล้ว"
        ORDER_DISCOUNT_APPLIED = "ORDER_DISCOUNT_APPLIED", "ให้ส่วนลดออเดอร์"
        TABLE_STATUS_OVERRIDE = "TABLE_STATUS_OVERRIDE", "แก้สถานะโต๊ะด้วยมือ"
        MENU_PRICE_CHANGED = "MENU_PRICE_CHANGED", "แก้ราคาเมนู"
        MASTER_DATA_DEACTIVATED = "MASTER_DATA_DEACTIVATED", "Soft-delete master data"
        STAFF_LOGIN_FAILED = "STAFF_LOGIN_FAILED", "ใส่ PIN ผิด"
        SESSION_TOKEN_REJECTED = "SESSION_TOKEN_REJECTED", "session_token หมดอายุ/ปิดแล้ว"
        SYNC_CONFLICT_RESOLVED = "SYNC_CONFLICT_RESOLVED", "Last-Write-Wins ทับข้อมูลเดิม"
        SYNC_IDEMPOTENT_REJECT = "SYNC_IDEMPOTENT_REJECT", "push ซ้ำ UUID เดิม"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="audit_logs")
    staff = models.ForeignKey(
        Staff, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )  # null = ระบบ/ลูกค้า
    action = models.CharField(max_length=40, choices=Action.choices)
    device_id = models.CharField(max_length=50)
    target_model = models.CharField(max_length=50)
    target_id = models.UUIDField()
    before_data = models.JSONField(null=True, blank=True)
    after_data = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField()  # เวลาที่เครื่อง POS บันทึก event จริง
    synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} on {self.target_model}:{self.target_id}"
