import uuid

from django.db import models

from apps.tenancy.models import Store


class Staff(models.Model):
    class Role(models.TextChoices):
        OWNER = "OWNER", "เจ้าของร้าน"
        MANAGER = "MANAGER", "ผู้จัดการ"
        CASHIER = "CASHIER", "แคชเชียร์"
        SERVER = "SERVER", "พนักงานเสิร์ฟ"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="staff")
    name = models.CharField(max_length=100)
    pin_code_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.SERVER)
    # ร้านอื่นๆ ที่เจ้าของคนนี้ดูแลด้วย (นอกจาก store หลักที่ผูก PIN login ไว้) — ใช้เฉพาะตอนรวมรายงาน
    # ข้ามร้าน (เช่น /api/orders/summary/) ไม่เกี่ยวกับ scope ของ JWT ที่ยังผูกกับ store เดียวเสมอ (rule ข้อ 5)
    additional_stores = models.ManyToManyField(
        Store, related_name="owner_viewers", blank=True
    )
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.role})"
