import uuid

from django.db import models


class Store(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store_code = models.CharField(max_length=20, unique=True, help_text="รหัสร้านสั้นๆ ใช้แทน UUID ตอนตั้งค่าอุปกรณ์/login เช่น XPOS01")
    name = models.CharField(max_length=200)
    tax_id = models.CharField(
        max_length=20, blank=True, null=True, help_text="เลขประจำตัวผู้เสียภาษีอากร 13 หลัก — ต้องพิมพ์บนใบเสร็จตามกฎหมาย"
    )
    address = models.CharField(max_length=255, blank=True, null=True, help_text="ที่อยู่ร้าน — พิมพ์บนใบเสร็จ")
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, default=7.00)
    service_charge_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    sync_key_hash = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="hash ของ secret ที่ store-local backend ใช้ยืนยันตัวตนตอน sync ขึ้น cloud (ดู StoreSyncKeyAuthentication) — สร้าง/หมุนด้วย manage.py generate_store_sync_key",
    )
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name
