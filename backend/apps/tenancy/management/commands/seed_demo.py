from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand

from apps.floor.models import Table, Zone
from apps.menu.models import Category, MenuItem, ModifierGroup, ModifierOption
from apps.staff.models import Staff
from apps.tenancy.models import Store


class Command(BaseCommand):
    help = "สร้างข้อมูลตัวอย่างสำหรับทดสอบ Phase 1 (ร้าน 1 ร้าน, พนักงาน, โต๊ะ, เมนู)"

    def handle(self, *args, **options):
        store, _ = Store.objects.get_or_create(
            name="ร้านทดสอบ xPOS",
            defaults={
                "store_code": "XPOS01",
                "vat_rate": Decimal("7.00"),
                "service_charge_rate": Decimal("10.00"),
            },
        )

        owner, _ = Staff.objects.get_or_create(
            store=store,
            name="เจ้าของร้าน",
            defaults={"pin_code_hash": make_password("1111"), "role": Staff.Role.OWNER},
        )
        server, _ = Staff.objects.get_or_create(
            store=store,
            name="พนักงานเสิร์ฟ",
            defaults={"pin_code_hash": make_password("2222"), "role": Staff.Role.SERVER},
        )

        zone, _ = Zone.objects.get_or_create(store=store, name="โซนหลัก")
        for name in ["T1", "T2", "T3", "T4"]:
            Table.objects.get_or_create(zone=zone, name=name, defaults={"seats": 4})

        category, _ = Category.objects.get_or_create(store=store, name="อาหารจานหลัก")
        drinks, _ = Category.objects.get_or_create(store=store, name="เครื่องดื่ม")

        pad_thai, _ = MenuItem.objects.get_or_create(
            store=store, category=category, name="ผัดไทย", defaults={"price": Decimal("80.00")}
        )
        fried_rice, _ = MenuItem.objects.get_or_create(
            store=store, category=category, name="ข้าวผัด", defaults={"price": Decimal("70.00")}
        )
        iced_tea, _ = MenuItem.objects.get_or_create(
            store=store, category=drinks, name="ชาเย็น", defaults={"price": Decimal("35.00")}
        )

        spice_group, _ = ModifierGroup.objects.get_or_create(store=store, name="ระดับความเผ็ด")
        spice_group.menu_items.add(pad_thai, fried_rice)
        for name, price in [("ไม่เผ็ด", "0.00"), ("เผ็ดน้อย", "0.00"), ("เผ็ดมาก", "5.00")]:
            ModifierOption.objects.get_or_create(
                group=spice_group, name=name, defaults={"extra_price": Decimal(price)}
            )

        self.stdout.write(self.style.SUCCESS("Seed เสร็จแล้ว:"))
        self.stdout.write(f"  store_code = {store.store_code}")
        self.stdout.write(f"  store_id = {store.id}")
        self.stdout.write(f"  owner PIN = 1111, server PIN = 2222")
        self.stdout.write(f"  tables = T1..T4 in zone '{zone.name}'")
