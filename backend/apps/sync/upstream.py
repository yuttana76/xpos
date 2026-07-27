"""HTTP client ฝั่ง store-local backend — เรียก cloud API เพื่อ pull master data ลงมาและ push orders ขึ้นไป
(§17 spec-xpost-gemini.md) ไม่ทำอะไรถ้ารันเป็น cloud deployment เอง (ดู tasks.py — no-op เมื่อ CLOUD_API_URL ว่าง)"""

import logging

import requests
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.floor.models import Table, Zone
from apps.menu.models import Category, KitchenPrinter, MenuItem, ModifierGroup, ModifierOption
from apps.orders.models import Order
from apps.staff.models import Staff
from apps.tenancy.models import Store

from .models import UpstreamSyncState

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 30


def _auth_headers():
    return {"Authorization": f"StoreSync {settings.CLOUD_SYNC_KEY}"}


def _defaults(row, rename=None, exclude=()):
    """แปลง 1 row จาก sync payload เป็น kwargs สำหรับ update_or_create(defaults=...) — ตัด id/updated_at
    ออกเสมอ (auto_now คุมเอง) แล้ว rename field ที่ต่างจากชื่อจริงบน model (FK เขียนเป็น <field>_id)"""
    rename = rename or {}
    skip = {"id", "updated_at", *exclude}
    return {rename.get(k, k): v for k, v in row.items() if k not in skip}


def apply_master_data_payload(payload):
    """upsert-by-UUID ลง local DB ตามลำดับ FK dependency — cloud เป็นเจ้าของ master data ตัวจริง
    (ยืนยันแล้วใน §17 spec-xpost-gemini.md ว่าไม่ใช่ทิศทางย้อนกลับ)"""
    store_row = payload["store_settings"]
    store_id = store_row["id"]
    Store.objects.update_or_create(id=store_id, defaults=_defaults(store_row))

    for row in payload["staff"]:
        Staff.objects.update_or_create(id=row["id"], defaults={**_defaults(row), "store_id": store_id})

    for row in payload["zones"]:
        Zone.objects.update_or_create(id=row["id"], defaults={**_defaults(row), "store_id": store_id})

    for row in payload["kitchen_printers"]:
        KitchenPrinter.objects.update_or_create(
            id=row["id"], defaults={**_defaults(row), "store_id": store_id}
        )

    for row in payload["tables"]:
        Table.objects.update_or_create(id=row["id"], defaults=_defaults(row, rename={"zone": "zone_id"}))

    for row in payload["categories"]:
        Category.objects.update_or_create(
            id=row["id"],
            defaults={
                **_defaults(row, rename={"kitchen_printer": "kitchen_printer_id"}),
                "store_id": store_id,
            },
        )

    for row in payload["menu_items"]:
        MenuItem.objects.update_or_create(
            id=row["id"],
            defaults={**_defaults(row, rename={"category": "category_id"}), "store_id": store_id},
        )

    for row in payload["modifier_groups"]:
        group, _created = ModifierGroup.objects.update_or_create(
            id=row["id"],
            defaults={**_defaults(row, exclude=("menu_items",)), "store_id": store_id},
        )
        group.menu_items.set(row["menu_items"])

    for row in payload["modifier_options"]:
        ModifierOption.objects.update_or_create(
            id=row["id"], defaults=_defaults(row, rename={"group": "group_id"})
        )


def pull_from_cloud():
    state = UpstreamSyncState.load()
    since = state.last_pull_at.isoformat() if state.last_pull_at else ""
    url = f"{settings.CLOUD_API_URL.rstrip('/')}/api/sync/store/pull/"

    response = requests.get(
        url, params={"since": since}, headers=_auth_headers(), timeout=REQUEST_TIMEOUT
    )
    response.raise_for_status()
    payload = response.json()

    apply_master_data_payload(payload)

    state.last_pull_at = parse_datetime(payload["server_time"])
    state.save(update_fields=["last_pull_at"])
    logger.info("pull_from_cloud: applied master data as of %s", state.last_pull_at)


def _build_order_push_payload(order):
    items_payload = []
    for item in order.items.all():
        items_payload.append(
            {
                "id": str(item.id),
                "menu_item_id": str(item.menu_item_id),
                "quantity": item.quantity,
                "unit_price": str(item.unit_price),
                "notes": item.notes,
                "kitchen_status": item.kitchen_status,
                "channel": item.channel,
                "added_by_id": str(item.added_by_id) if item.added_by_id else None,
                "is_takeaway": item.is_takeaway,
                "modifiers": [
                    {
                        "id": str(mod.id),
                        "modifier_option_id": str(mod.modifier_option_id),
                        "extra_price": str(mod.extra_price),
                    }
                    for mod in item.selected_modifiers.all()
                ],
            }
        )

    return {
        "id": str(order.id),
        "device_id": order.device_id,
        "receipt_number": order.receipt_number,
        "order_type": order.order_type,
        "table_id": str(order.table_id) if order.table_id else None,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "opened_by_id": str(order.opened_by_id),
        "paid_by_id": str(order.paid_by_id) if order.paid_by_id else None,
        "status": order.status,
        "session_token": order.session_token,
        "discount": str(order.discount),
        "payment_method": order.payment_method,
        "created_at": order.created_at.isoformat(),
        "items": items_payload,
    }


def push_orders_to_cloud():
    state = UpstreamSyncState.load()
    since = state.last_push_at
    captured_at = timezone.now()

    query = Order.objects.prefetch_related("items__selected_modifiers")
    if since:
        query = query.filter(updated_at__gt=since)
    orders = list(query)

    if not orders:
        logger.info("push_orders_to_cloud: nothing to push")
        state.last_push_at = captured_at
        state.save(update_fields=["last_push_at"])
        return

    url = f"{settings.CLOUD_API_URL.rstrip('/')}/api/sync/orders/push/"
    body = {"orders": [_build_order_push_payload(order) for order in orders]}
    response = requests.post(url, json=body, headers=_auth_headers(), timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    state.last_push_at = captured_at
    state.save(update_fields=["last_push_at"])
    logger.info("push_orders_to_cloud: pushed %d orders", len(orders))
