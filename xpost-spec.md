# 🚀 Project Specification: Restaurant POS System (Phase 1 MVP)

## 📌 Context & Objective
คุณคือ **Senior Full-Stack Software Engineer & Software Architect**
เป้าหมายของโปรเจกต์นี้คือการพัฒนาระบบ **Point of Sale (POS) สำหรับร้านอาหาร (Food & Beverage)** ในรูปแบบ **SaaS-First Hybrid Model** ที่มีความยืดหยุ่นสูง โดยใช้สถาปัตยกรรม **Offline-First** หน้าร้านต้องสามารถทำงานได้ 100% (เปิดโต๊ะ, สั่งอาหาร, พิมพ์ออกครัว, คิดเงิน) แม้ไม่มีอินเทอร์เน็ต แล้วค่อยซิงค์ข้อมูลกลับ Cloud เมื่อเน็ตกลับมาใช้งานได้

---

## 🎯 Phase Scope

| Feature | Phase 1 (MVP) | Phase 2+ |
|---|---|---|
| Multi-tenancy (Store scoping) | ✅ ออกแบบตั้งแต่ต้น | รองรับ billing/plan แยกต่อ Store |
| Staff login (PIN) + Audit Trail | ✅ | เพิ่ม fine-grained permission ต่อ role |
| VAT / Service Charge | ✅ | ปรับอัตราภาษีแบบ per-item ได้ |
| Offline-First Order/Payment | ✅ | - |
| Soft-delete บน Master Data | ✅ | - |
| ลูกค้าสั่งอาหารเองผ่าน QR/Barcode (Self-Order) | ✅ | เพิ่ม real-time cart sync ระหว่างลูกค้าหลายคนในโต๊ะเดียวกัน |
| พนักงานสั่งอาหารแทนลูกค้า | ✅ | - |
| ออเดอร์ Takeaway (โทรสั่ง/มาที่ร้านไม่นั่งโต๊ะ) | ✅ | ระบบ SMS/LINE Notify แจ้งลูกค้าเมื่อของเสร็จ |
| แท็กรายการ "กลับบ้าน" แยกในบิลนั่งโต๊ะ | ✅ | - |
| Split Payment (จ่ายหลายวิธีในออเดอร์เดียว) | ❌ | ✅ |
| Kitchen Display System (KDS) แบบ real-time | ❌ (ใช้ printer เป็นหลัก) | ✅ |
| Promotion / Loyalty | ❌ | ✅ |
| Multi-branch reporting รวมศูนย์ | ❌ | ✅ |

> หมายเหตุ: item ที่ทำเฉพาะ Phase 1 ในสเป็กนี้จะกำกับด้วย `# Phase 1` ในโค้ด/schema เพื่อให้ตอนขยายงาน Phase 2 หาจุดแก้ได้ง่าย

---

## 🛠 Tech Stack Overview
- **Backend (Cloud / SaaS):** Python (Django REST Framework)
- **Database (Cloud):** PostgreSQL
- **Frontend (POS Client App):** Next.js / React (Configured as PWA)
- **Local Client Database (Offline Storage):** IndexedDB via `Dexie.js`
- **Containerization & Deployment:** Docker & Docker Compose
- **Communication Protocol:** REST APIs + JSON Data Sync Payload

---

## 📐 Core Architecture Rules
1. **UUID Primacy:** ทุก Entity ต้องใช้ **UUIDv4** เป็น Primary Key เท่านั้น ห้ามใช้ Auto-increment ID เด็ดขาด เพื่อป้องกัน ID ชนกันระหว่างเครื่องหน้าร้านช่วงออฟไลน์
2. **Local-First Writes:** การกดสั่งอาหารและคิดเงินหน้าร้าน ต้องบันทึกลง **IndexedDB (Dexie.js)** ในเบราว์เซอร์ก่อนเสมอ แล้วส่งงานเข้า **Sync Queue** เพื่อรอส่งขึ้น Django Cloud
3. **Receipt Number Generation:** เลขที่ใบเสร็จต้องมี Prefix ประจำเครื่องเสมอ เช่น `POS01-20260724-0001` เพื่อป้องกันเลขซ้ำตอนออฟไลน์
4. **Incremental Sync Engine:**
   - **Pull (Cloud -> Client):** ดึงเฉพาะเมนู/โต๊ะที่ฟิลด์ `updated_at > last_sync_timestamp` **และ** `store_id` ตรงกับเครื่องที่ล็อกอินอยู่เท่านั้น
   - **Push (Client -> Cloud):** ส่งก้อนออเดอร์ใน Queue ไปยัง `/api/sync/orders/` แบบ Bulk `transaction.atomic()`
   - **Idempotency:** ฝั่ง Django ต้องตรวจสอบ UUID ของ Order ก่อนบันทึก หากพบ UUID เดิมแล้ว ให้ตอบกลับ 200 OK ทันทีโดยไม่บันทึกซ้ำ

5. **Multi-Tenancy (Store Scoping) — Phase 1:** ทุก Entity ระดับร้าน (Zone, Table, KitchenPrinter, Category, MenuItem, ModifierGroup, Staff, Order) ต้องมี FK `store` เสมอ และทุก query/sync ฝั่ง Django ต้อง filter ด้วย `store_id` ที่ผูกกับ session/JWT ของอุปกรณ์ ห้าม trust `store_id` ที่ client ส่งมาตรงๆ

6. **Soft Delete บน Master Data — Phase 1:** ห้าม hard-delete ข้อมูลที่ถูก sync แบบ incremental (Zone, Table, Category, MenuItem, ModifierGroup, ModifierOption, KitchenPrinter) ให้ใช้ flag `is_active=False` แทน เพื่อให้ pull sync (`updated_at > last_sync`) ส่งสถานะ "ถูกลบ" ไปให้ client ลบออกจาก Dexie.js ได้ถูกต้อง

7. **Conflict Resolution Policy — Phase 1:** ใช้ **Last-Write-Wins ตาม `updated_at`** สำหรับ Master Data (Table status, MenuItem) หากสองเครื่องแก้พร้อมกัน ค่าที่ sync เข้ามาทีหลังจะทับค่าก่อนหน้า สำหรับ Order/OrderItem ให้ยึดหลักว่า 1 โต๊ะ ควรถูกจัดการโดย 1 อุปกรณ์ ณ เวลาหนึ่งเท่านั้น (บังคับใน UX ไม่ใช่ระดับ DB) เพื่อลดโอกาสชนกันของข้อมูลออเดอร์เดียวกัน

8. **Kitchen Printing ผ่าน Local Print Agent — Phase 1:** PWA/Browser ไม่สามารถเปิด raw TCP socket ไปยัง `KitchenPrinter.ip_address` ได้โดยตรง (ข้อจำกัดความปลอดภัยของเบราว์เซอร์) ต้องมี **Local Print Agent** (บริการเล็กๆ รันบนเครื่อง POS หรือ LAN เดียวกัน) รับคำสั่งพิมพ์จาก PWA ผ่าน `localhost`/WebSocket แล้วค่อยส่ง ESC/POS command ไปยัง IP เครื่องพิมพ์จริง

9. **Receipt Counter Persistence — Phase 1:** ตัวนับเลขใบเสร็จต่อเครื่อง (ต่อจาก prefix เช่น `POS01`) ต้อง persist ไว้ใน Dexie.js ของอุปกรณ์นั้น และห้าม reset ตอนแอป restart เพื่อป้องกันเลขใบเสร็จซ้ำกับที่เคยออกไปแล้ว

10. **Self-Order Session Token (QR/Barcode) — Phase 1:** ทุกครั้งที่พนักงานเปิดโต๊ะ (สร้าง `Order` ใหม่ สถานะ `OPEN`) ระบบต้อง generate `session_token` แบบสุ่ม ไม่ซ้ำ (เช่น `secrets.token_urlsafe`) ผูกกับ Order นั้นโดยเฉพาะ แล้วพิมพ์/แสดงเป็น QR ให้ลูกค้าสแกน **token นี้ใช้ได้เฉพาะช่วงที่ `Order.status == OPEN` เท่านั้น** — เมื่อ Order ถูกชำระเงินหรือยกเลิก token เดิมจะใช้สั่งอาหารไม่ได้ทันที (reject ที่ทั้งขั้นตอนเปิดเมนูและขั้นตอน submit ออเดอร์) รอบถัดไปที่โต๊ะเปิดใหม่จะได้ Order + token ใหม่เสมอ ไม่มีการนำ token เก่ากลับมาใช้ซ้ำ

11. **Order Type: Dine-in vs Takeaway — Phase 1:** ทุก `Order` ต้องระบุ `order_type` (`DINE_IN` / `TAKEAWAY`)
    - **TAKEAWAY** (ลูกค้าโทรสั่งหรือมาสั่งหน้าร้านโดยไม่นั่งโต๊ะ): `table = null` เสมอ, พนักงานเป็นคนคีย์ออเดอร์ผ่าน POS โดยตรง (ไม่มี self-order QR เพราะไม่มีโต๊ะให้สแกน) → `session_token = null` เสมอด้วย เพราะไม่มี flow ที่ต้องใช้ token นี้
    - **DINE_IN แต่บางรายการสั่งกลับบ้าน**: Order ยังคงเป็น `DINE_IN` และผูก `table` ตามปกติ แต่แท็กเฉพาะรายการนั้นด้วย `OrderItem.is_takeaway=True` เพื่อให้ครัวรู้ว่าต้องแพ็คใส่กล่องแยกจากรายการที่เสิร์ฟที่โต๊ะ — ใบสั่งครัว (kitchen ticket) ต้องพิมพ์ป้าย `[กลับบ้าน]` กำกับรายการเหล่านี้ให้เห็นชัด

12. **ลำดับการคำนวณยอดเงิน (Discount → Service Charge → VAT) — Phase 1:** ราคาใน `MenuItem.price` เป็นราคา **ไม่รวม VAT** (exclusive) คำนวณยอด Order ตามลำดับนี้เสมอ ห้ามสลับ:
    1. `subtotal` = Σ (`OrderItem.unit_price × quantity` + Σ `OrderItemModifier.extra_price × quantity`)
    2. หักส่วนลดก่อน: `after_discount = subtotal − discount`
    3. คิด service charge จากยอดหลังหักส่วนลด: `service_charge = after_discount × store.service_charge_rate / 100`
    4. คิด VAT จากยอดหลังหักส่วนลด + service charge: `tax_amount = (after_discount + service_charge) × store.vat_rate / 100`
    5. `total_amount = after_discount + service_charge + tax_amount`

    ทุกเครื่อง (Client Dexie.js และ Django ฝั่ง sync) ต้องใช้สูตรเดียวกันนี้ทุกจุดที่คำนวณ เพื่อไม่ให้ยอดที่หน้าร้านเห็นตอน offline กับยอดที่ cloud คำนวณตอน sync ไม่ตรงกัน

13. **Concurrency Lock ตอนอัปเดตยอด Order — Phase 1:** เพราะ 1 `Order` (โต๊ะเดียวกัน) อาจถูกเขียนพร้อมกันจากหลายช่องทาง (ลูกค้าหลายคน submit ผ่าน self-order + พนักงานสั่งแทนผ่าน POS พร้อมกัน — ดู Self-Order Flow ข้อ 4-5) ทุกครั้งที่ insert `OrderItem` ใหม่แล้วต้อง recalculate `subtotal`/`total_amount` ฝั่ง Django ต้อง:
    - เปิด `transaction.atomic()` ครอบทั้งก้อน
    - lock แถว Order ด้วย `Order.objects.select_for_update().get(id=order_id)` ก่อนอ่านค่าปัจจุบันมาบวกเพิ่ม
    - คำนวณยอดใหม่ตามสูตรข้อ 12 แล้วค่อย save

    เพื่อป้องกัน lost update ที่ยอดเงินของ Order เพี้ยนเมื่อสอง request เขียนทับกันแบบ interleaved

---

## 🗄 Database Schema (Django Models)

```python
import uuid
from django.db import models

# 0. TENANCY (Phase 1)
class Store(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    tax_id = models.CharField(max_length=20, blank=True, null=True)
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, default=7.00)
    service_charge_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

# 1. STAFF & AUDIT (Phase 1)
class Staff(models.Model):
    class Role(models.TextChoices):
        OWNER = 'OWNER', 'เจ้าของร้าน'
        MANAGER = 'MANAGER', 'ผู้จัดการ'
        CASHIER = 'CASHIER', 'แคชเชียร์'
        SERVER = 'SERVER', 'พนักงานเสิร์ฟ'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='staff')
    name = models.CharField(max_length=100)
    pin_code_hash = models.CharField(max_length=255)  # PIN สั้นสำหรับ login หน้าร้านแบบเร็ว ไม่ใช้ password เต็ม
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.SERVER)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

# 2. TABLE & ZONE MANAGEMENT
class Zone(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='zones')
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

class Table(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = 'AVAILABLE', 'ว่าง'
        OCCUPIED = 'OCCUPIED', 'มีลูกค้า'
        RESERVED = 'RESERVED', 'จอง'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    zone = models.ForeignKey(Zone, on_delete=models.CASCADE, related_name='tables')
    name = models.CharField(max_length=50)
    seats = models.IntegerField(default=4)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AVAILABLE)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

# 3. MENU & KITCHEN ROUTING
class KitchenPrinter(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='kitchen_printers')
    name = models.CharField(max_length=100)
    ip_address = models.GenericIPAddressField()
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

class Category(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='categories')
    name = models.CharField(max_length=100)
    kitchen_printer = models.ForeignKey(KitchenPrinter, on_delete=models.SET_NULL, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

class MenuItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='menu_items')
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='items')
    name = models.CharField(max_length=255)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    is_available = models.BooleanField(default=True)  # ของหมดชั่วคราว (86'd) ไม่ใช่การลบเมนู
    is_active = models.BooleanField(default=True)  # soft-delete: เมนูถูกเลิกขายถาวร
    version = models.BigIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

class ModifierGroup(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='modifier_groups')
    name = models.CharField(max_length=100)
    is_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    menu_items = models.ManyToManyField(MenuItem, related_name='modifier_groups')
    updated_at = models.DateTimeField(auto_now=True)

class ModifierOption(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    group = models.ForeignKey(ModifierGroup, on_delete=models.CASCADE, related_name='options')
    name = models.CharField(max_length=100)
    extra_price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

# 4. ORDERING & TRANSACTION (OFFLINE-FIRST)
class Order(models.Model):
    class OrderStatus(models.TextChoices):
        OPEN = 'OPEN', 'กำลังทาน'
        PAID = 'PAID', 'ชำระเงินแล้ว'
        CANCELLED = 'CANCELLED', 'ยกเลิก'

    class OrderType(models.TextChoices):
        DINE_IN = 'DINE_IN', 'ทานที่ร้าน'
        TAKEAWAY = 'TAKEAWAY', 'กลับบ้าน'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='orders')
    device_id = models.CharField(max_length=50)
    receipt_number = models.CharField(max_length=100, unique=True)
    order_type = models.CharField(max_length=20, choices=OrderType.choices, default=OrderType.DINE_IN)
    table = models.ForeignKey(Table, on_delete=models.SET_NULL, null=True, blank=True)  # null เมื่อ order_type=TAKEAWAY
    customer_name = models.CharField(max_length=100, blank=True, null=True)  # ใช้เรียกลูกค้าตอนของเสร็จ (เฉพาะ TAKEAWAY)
    customer_phone = models.CharField(max_length=20, blank=True, null=True)
    opened_by = models.ForeignKey(Staff, on_delete=models.PROTECT, related_name='opened_orders')
    paid_by = models.ForeignKey(Staff, on_delete=models.PROTECT, null=True, blank=True, related_name='paid_orders')
    status = models.CharField(max_length=20, choices=OrderStatus.choices, default=OrderStatus.OPEN)
    session_token = models.CharField(max_length=64, unique=True, db_index=True, editable=False, null=True, blank=True)  # gen เฉพาะ order_type=DINE_IN ตอนเปิดโต๊ะ, ใช้ได้แค่ตอน status=OPEN — TAKEAWAY เป็น null เสมอ (ข้อ 11)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)  # VAT
    service_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_method = models.CharField(max_length=50, null=True, blank=True)  # Phase 2: แยกเป็น Payment model เพื่อรองรับ split payment
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)  # ใช้ incremental sync สถานะออเดอร์กลับไปเครื่องอื่น (เช่น KDS)
    synced_at = models.DateTimeField(null=True, blank=True)

class OrderItem(models.Model):
    class KitchenStatus(models.TextChoices):
        PENDING = 'PENDING', 'รอส่งครัว'
        SENT = 'SENT', 'ส่งครัวแล้ว'
        SERVED = 'SERVED', 'เสิร์ฟแล้ว'

    class Channel(models.TextChoices):
        STAFF = 'STAFF', 'พนักงานสั่งให้'
        CUSTOMER = 'CUSTOMER', 'ลูกค้าสั่งเอง (QR/Barcode)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
    menu_item = models.ForeignKey(MenuItem, on_delete=models.PROTECT)
    quantity = models.IntegerField(default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    notes = models.TextField(blank=True, null=True)
    kitchen_status = models.CharField(max_length=20, choices=KitchenStatus.choices, default=KitchenStatus.PENDING)
    channel = models.CharField(max_length=20, choices=Channel.choices, default=Channel.STAFF)
    added_by = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, blank=True)  # null เมื่อ channel=CUSTOMER
    is_takeaway = models.BooleanField(default=False)  # true = แพ็คกลับบ้าน แม้ Order เป็น DINE_IN
    updated_at = models.DateTimeField(auto_now=True)  # KDS pull sync อ้างอิง field นี้

class OrderItemModifier(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_item = models.ForeignKey(OrderItem, on_delete=models.CASCADE, related_name='selected_modifiers')
    modifier_option = models.ForeignKey(ModifierOption, on_delete=models.PROTECT)
    extra_price = models.DecimalField(max_digits=10, decimal_places=2)
```

---

## 🧾 Self-Order Flow (ลูกค้าสแกน QR สั่งอาหารเอง) — Phase 1

1. **เปิดโต๊ะ:** พนักงานเปิดโต๊ะในระบบ POS → สร้าง `Order` (status `OPEN`) → ระบบ gen `session_token` ใหม่ → พิมพ์/แสดงเป็น QR ให้ลูกค้าที่โต๊ะ (endpoint นี้เป็น **public, ไม่ต้อง login**)
2. **ลูกค้าสแกน QR → เปิดเมนู:** `GET /api/public/order-session/<session_token>/menu/`
   - Backend ตรวจสอบก่อนเสมอ: token มีอยู่จริง + `Order.status == OPEN` + `Table.status == OCCUPIED` (ยังไม่ได้ปิด/ชำระเงินแล้ว) ถ้าไม่ผ่าน ตอบ 410 Gone / error message ให้เรียกพนักงาน
   - คืนเมนูที่ `store` เดียวกัน จัดกลุ่มตาม `Category` แสดงเฉพาะ `MenuItem.is_active=True` และ `is_available=True` พร้อม `ModifierGroup`/`ModifierOption`
3. **เลือกลงตะกร้า:** ฝั่ง client (browser ลูกค้า) เก็บตะกร้าไว้ใน local state/session ก่อน **ยังไม่ยิง API ทีละรายการ** จนกว่าลูกค้าจะกด "ยืนยันสั่ง"
4. **Submit ออเดอร์:** `POST /api/public/order-session/<session_token>/items/` ส่งตะกร้าทั้งหมดเป็นก้อนเดียว
   - Backend **ตรวจสอบสถานะ Order/Table ซ้ำอีกครั้ง** (กันเคส parent ปิดบิลระหว่างลูกค้ากำลังเลือกเมนูอยู่) ก่อน insert
   - สร้าง `OrderItem` ทีละรายการด้วย `channel='CUSTOMER'`, `added_by=None`, `kitchen_status='PENDING'` เข้าคิวครัวทันทีเหมือนพนักงานสั่งเอง
   - อัปเดตยอดรวมของ Order ต้อง lock row ด้วย `select_for_update()` ตาม rule ข้อ 13 ก่อนคำนวณใหม่ (กันชนกับพนักงานที่อาจสั่งแทนเข้า Order เดียวกันพร้อมกัน) แล้วคำนวณตามสูตรข้อ 12
   - ตอบกลับสถานะยืนยัน + อัปเดตยอดรวมของ Order ให้ลูกค้าเห็น
5. **พนักงานสั่งแทนลูกค้า:** ทำผ่านหน้า POS ปกติ (ต้อง login ด้วย PIN) สร้าง `OrderItem` ด้วย `channel='STAFF'`, `added_by=<Staff ปัจจุบัน>` เข้าคิวครัวเส้นทางเดียวกับข้อ 4 — รายการจาก 2 ช่องทางนี้ปนกันอยู่ใน `Order` เดียวกันได้ตามปกติ
6. **จบรอบโต๊ะ:** เมื่อ Order ถูกชำระเงิน (`status='PAID'`) `session_token` เดิมใช้ไม่ได้ทันที ลูกค้าที่ยังเปิดหน้าเมนูค้างอยู่ (session เก่า) จะสั่งซ้ำไม่ได้ ต้องรอพนักงานเปิดโต๊ะรอบใหม่เพื่อรับ token ใหม่
7. **ออเดอร์ Takeaway ไม่ผ่าน flow นี้:** ลูกค้าโทรสั่งหรือมาสั่งหน้าร้าน (`order_type='TAKEAWAY'`, ไม่มี `table`) พนักงานคีย์ออเดอร์ให้ผ่าน POS โดยตรงเท่านั้น ไม่มี QR/self-order เพราะไม่มีโต๊ะให้สแกน — กรอก `customer_name`/`customer_phone` ไว้เรียกตอนของเสร็จ

---

## 📋 Audit Trail & Logging — Phase 1

> ระบุไว้ในข้อ 14 ของสเป็คตั้งแต่ต้น (Staff login + Audit Trail) แต่ยังไม่มี model รองรับ — ส่วนนี้คือการเติมเต็ม gap นั้น

### 1. `AuditLog` (Business/Domain log — append-only, ห้าม update/delete)

ครอบคลุมเหตุการณ์ที่กระทบเงินหรือความน่าเชื่อถือของข้อมูล ซึ่งเป็นจุดที่ POS ทั่วไปมักถูกใช้โกง (ยกเลิกออเดอร์หลังรับเงินสด, ลบรายการที่ส่งครัวไปแล้วเพื่อเบิกวัตถุดิบแต่ไม่ลงบิล, แก้ราคาเมนูชั่วคราวแล้วแก้กลับ ฯลฯ)

```python
class AuditLog(models.Model):
    class Action(models.TextChoices):
        ORDER_CANCELLED = 'ORDER_CANCELLED', 'ยกเลิกออเดอร์'
        ORDER_ITEM_VOIDED = 'ORDER_ITEM_VOIDED', 'ลบรายการอาหารหลังส่งครัวแล้ว'
        ORDER_DISCOUNT_APPLIED = 'ORDER_DISCOUNT_APPLIED', 'ให้ส่วนลดออเดอร์'
        TABLE_STATUS_OVERRIDE = 'TABLE_STATUS_OVERRIDE', 'แก้สถานะโต๊ะด้วยมือ (นอกเหนือ flow ปกติ)'
        MENU_PRICE_CHANGED = 'MENU_PRICE_CHANGED', 'แก้ราคาเมนู'
        MASTER_DATA_DEACTIVATED = 'MASTER_DATA_DEACTIVATED', 'Soft-delete master data (is_active=False)'
        STAFF_LOGIN_FAILED = 'STAFF_LOGIN_FAILED', 'ใส่ PIN ผิด'
        SESSION_TOKEN_REJECTED = 'SESSION_TOKEN_REJECTED', 'ลูกค้าพยายามใช้ session_token ที่หมดอายุ/ปิดแล้ว'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='audit_logs')
    staff = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')  # null = ระบบ/ลูกค้า (เช่น SESSION_TOKEN_REJECTED)
    action = models.CharField(max_length=40, choices=Action.choices)
    device_id = models.CharField(max_length=50)  # เกิด local-first เหมือน Order เพื่อรองรับ offline
    target_model = models.CharField(max_length=50)   # เช่น 'Order', 'OrderItem', 'MenuItem'
    target_id = models.UUIDField()
    before_data = models.JSONField(null=True, blank=True)  # snapshot ก่อนแก้ (ไม่ต้อง fetch FK เดิม เพราะอาจถูกลบไปแล้ว)
    after_data = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField()  # เวลาที่เครื่อง POS บันทึก event จริง (ไม่ใช่เวลา sync เข้า cloud)
    synced_at = models.DateTimeField(null=True, blank=True)
```

หลักการ:
- **Local-first เหมือน `Order`:** เหตุการณ์ที่เกิดหน้าร้าน (ยกเลิก/ลบรายการ/ส่วนลด) ต้องเขียนลง Dexie.js ก่อน แล้วเข้า sync queue ไปพร้อมกับ payload ของ Order นั้น — ห้ามรอ sync แล้วค่อย log เพราะถ้าเน็ตหลุดจะไม่มีหลักฐานอะไรเลย
- **Append-only:** ไม่มี endpoint แก้ไข/ลบ `AuditLog` แม้แต่ฝั่ง Owner
- **`before_data`/`after_data` เป็น JSON snapshot** ไม่ใช้ FK ไปยัง record จริง เพราะ record นั้นอาจถูก soft-delete หรือถูกแก้ทับไปแล้วตอนอ่านย้อนหลัง
- **Retention:** เก็บอย่างน้อยตามอายุที่กฎหมายภาษี/บัญชีกำหนด (ในไทยทั่วไปอ้างอิง 5 ปี) ไม่ใช่ log ที่ auto-expire แบบ system log

### 2. Sync/Conflict log (server-side only)

ทุกครั้งที่ Django เจอกรณีต่อไปนี้ระหว่าง sync ให้บันทึกลง `AuditLog` เดิม (target_model ระบุ entity ที่ชน, action ใช้ค่าที่ใกล้เคียงที่สุด หรือเพิ่ม action ใหม่ `SYNC_CONFLICT_RESOLVED` / `SYNC_IDEMPOTENT_REJECT` ตามต้องการ):
- Last-Write-Wins ทับค่าเดิมของ Master Data (ข้อ 7)
- Idempotency reject ตอน push Order UUID ซ้ำ (ข้อ 4)

ส่วนนี้ log เพื่อ debug ข้อมูลเพี้ยนระหว่างเครื่อง ไม่ต้อง local-first เพราะเกิดขึ้นที่ฝั่ง cloud อยู่แล้ว

### 3. Application/System log (มาตรฐาน ไม่ต้องออกแบบพิเศษ)

- Django: ใช้ logging module ปกติ + error tracking (เช่น Sentry) สำหรับ exception/API failure — แยก logger ต่างหากจาก `AuditLog` เพราะเป้าหมายคือ debug ระบบ ไม่ใช่หลักฐานทางธุรกิจ
- Local Print Agent (ข้อ 8): log ผลการพิมพ์แต่ละ job (success/fail/ip ที่พิมพ์ไม่ติด) ไว้ในเครื่อง เพราะเป็นจุดที่ล้มเหลวบ่อยและ debug ยากที่สุดถ้าไม่มี log

### 4. API: ดู `AuditLog` (อ่านอย่างเดียว)

```python
# views.py
class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    # ไม่มี create/update/delete ผ่าน API — AuditLog เกิดได้จาก 2 ทางเท่านั้น: sync push (ข้อ 1) หรือ server เขียนเองตอน sync (ข้อ 2)
    permission_classes = [IsAuthenticated, IsOwnerOrManager]  # SERVER/CASHIER ห้ามเห็น เพราะเป็นเป้าหมายหลักที่ log ตรวจสอบ
    serializer_class = AuditLogSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['action', 'staff', 'target_model', 'target_id']

    def get_queryset(self):
        # store scoping ตาม rule ข้อ 5 — ห้าม trust store_id จาก client, ผูกกับ JWT/session เท่านั้น
        return AuditLog.objects.filter(store_id=self.request.user.store_id).order_by('-created_at')
```

```python
# admin.py — สำหรับ Owner เปิดดูตรงๆ ผ่าน Django admin ได้เช่นกัน
@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'store', 'staff', 'action', 'target_model', 'target_id')
    list_filter = ('store', 'action')
    readonly_fields = [f.name for f in AuditLog._meta.fields]  # บังคับอ่านอย่างเดียวแม้ใน admin

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
```

### 5. Client-side: Dexie.js schema

`AuditLog` ที่เกิดหน้าร้าน (ยกเลิก/ลบรายการ/ส่วนลด) ต้องเขียนลง IndexedDB ก่อนเสมอ (rule ข้อ 2) แล้วส่งขึ้น cloud พร้อม batch เดียวกับ Order/OrderItem ที่เกี่ยวข้อง — ไม่แยก endpoint sync ต่างหาก เพื่อไม่ให้เกิดเคส Order sync สำเร็จแต่ AuditLog ของ action ที่เกี่ยวข้องหาย

```javascript
// db.js
db.version(1).stores({
  // ...tables, categories, menu_items, orders, order_items ที่มีอยู่แล้ว
  audit_logs: 'id, store_id, action, target_model, target_id, created_at, synced_at',
});

// เขียน log ตอนกดยกเลิก/ลบรายการ/ส่วนลด — เกิดพร้อมกับ transaction ที่แก้ Order/OrderItem จริง ไม่ใช่ทีหลัง
async function writeAuditLog({ storeId, staffId, action, targetModel, targetId, before, after }) {
  await db.audit_logs.add({
    id: crypto.randomUUID(),
    store_id: storeId,
    staff_id: staffId,
    device_id: getDeviceId(),
    action,
    target_model: targetModel,
    target_id: targetId,
    before_data: before,
    after_data: after,
    created_at: new Date().toISOString(),
    synced_at: null,
  });
  await enqueueSyncPush('audit_logs', targetId); // เข้า sync queue เดียวกับ order push
}
```