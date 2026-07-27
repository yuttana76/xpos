import uuid

from django.db import models

from apps.floor.models import Table
from apps.menu.models import MenuItem, ModifierOption
from apps.staff.models import Staff
from apps.tenancy.models import Store


class Order(models.Model):
    class OrderStatus(models.TextChoices):
        OPEN = "OPEN", "กำลังทาน"
        PAID = "PAID", "ชำระเงินแล้ว"
        CANCELLED = "CANCELLED", "ยกเลิก"

    class OrderType(models.TextChoices):
        DINE_IN = "DINE_IN", "ทานที่ร้าน"
        TAKEAWAY = "TAKEAWAY", "กลับบ้าน"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="orders")
    device_id = models.CharField(max_length=50)
    receipt_number = models.CharField(max_length=100, unique=True)
    order_type = models.CharField(
        max_length=20, choices=OrderType.choices, default=OrderType.DINE_IN
    )
    table = models.ForeignKey(
        Table, on_delete=models.SET_NULL, null=True, blank=True
    )  # null เมื่อ order_type=TAKEAWAY
    customer_name = models.CharField(max_length=100, blank=True, null=True)
    customer_phone = models.CharField(max_length=20, blank=True, null=True)
    opened_by = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name="opened_orders")
    paid_by = models.ForeignKey(
        Staff, on_delete=models.PROTECT, null=True, blank=True, related_name="paid_orders"
    )
    status = models.CharField(max_length=20, choices=OrderStatus.choices, default=OrderStatus.OPEN)
    session_token = models.CharField(
        max_length=64, unique=True, db_index=True, editable=False, null=True, blank=True
    )  # gen เฉพาะ order_type=DINE_IN ตอนเปิดโต๊ะ, ใช้ได้แค่ตอน status=OPEN — TAKEAWAY เป็น null เสมอ
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    service_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_method = models.CharField(max_length=50, null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)
    synced_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.receipt_number


class OrderItem(models.Model):
    class KitchenStatus(models.TextChoices):
        PENDING = "PENDING", "รอส่งครัว"
        SENT = "SENT", "ส่งครัวแล้ว"
        SERVED = "SERVED", "เสิร์ฟแล้ว"

    class Channel(models.TextChoices):
        STAFF = "STAFF", "พนักงานสั่งให้"
        CUSTOMER = "CUSTOMER", "ลูกค้าสั่งเอง (QR/Barcode)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    menu_item = models.ForeignKey(MenuItem, on_delete=models.PROTECT)
    quantity = models.IntegerField(default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    notes = models.TextField(blank=True, null=True)
    kitchen_status = models.CharField(
        max_length=20, choices=KitchenStatus.choices, default=KitchenStatus.PENDING
    )
    channel = models.CharField(max_length=20, choices=Channel.choices, default=Channel.STAFF)
    added_by = models.ForeignKey(
        Staff, on_delete=models.SET_NULL, null=True, blank=True
    )  # null เมื่อ channel=CUSTOMER
    is_takeaway = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.menu_item.name} x{self.quantity}"


class OrderItemModifier(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_item = models.ForeignKey(
        OrderItem, on_delete=models.CASCADE, related_name="selected_modifiers"
    )
    modifier_option = models.ForeignKey(ModifierOption, on_delete=models.PROTECT)
    extra_price = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return self.modifier_option.name
