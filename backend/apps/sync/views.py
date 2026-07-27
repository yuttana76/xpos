from datetime import datetime, timezone as dt_timezone
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.floor.models import Table, Zone
from apps.menu.models import Category, KitchenPrinter, MenuItem, ModifierGroup, ModifierOption
from apps.orders import services
from apps.orders.models import Order, OrderItem, OrderItemModifier
from apps.orders.serializers import OrderSerializer

from .serializers import (
    CategorySyncSerializer,
    KitchenPrinterSyncSerializer,
    MenuItemSyncSerializer,
    ModifierGroupSyncSerializer,
    ModifierOptionSyncSerializer,
    TableSyncSerializer,
    ZoneSyncSerializer,
)

EPOCH = datetime(1970, 1, 1, tzinfo=dt_timezone.utc)


def _parse_dt(value, default=None):
    if not value:
        return default
    parsed = parse_datetime(value)
    return parsed or default


class SyncPullView(APIView):
    """GET /api/sync/pull/?since=<ISO8601> — เฉพาะ master data ของ store ที่ผูกกับ JWT (rule ข้อ 4, 5)"""

    def get(self, request):
        store_id = request.user.store_id
        since = _parse_dt(request.query_params.get("since"), default=EPOCH)

        zones = Zone.objects.filter(store_id=store_id, updated_at__gt=since)
        tables = Table.objects.filter(zone__store_id=store_id, updated_at__gt=since)
        printers = KitchenPrinter.objects.filter(store_id=store_id, updated_at__gt=since)
        categories = Category.objects.filter(store_id=store_id, updated_at__gt=since)
        menu_items = MenuItem.objects.filter(store_id=store_id, updated_at__gt=since)
        modifier_groups = ModifierGroup.objects.filter(store_id=store_id, updated_at__gt=since)
        modifier_options = ModifierOption.objects.filter(
            group__store_id=store_id, updated_at__gt=since
        )

        return Response(
            {
                "server_time": timezone.now().isoformat(),
                "zones": ZoneSyncSerializer(zones, many=True).data,
                "tables": TableSyncSerializer(tables, many=True).data,
                "kitchen_printers": KitchenPrinterSyncSerializer(printers, many=True).data,
                "categories": CategorySyncSerializer(categories, many=True).data,
                "menu_items": MenuItemSyncSerializer(menu_items, many=True).data,
                "modifier_groups": ModifierGroupSyncSerializer(modifier_groups, many=True).data,
                "modifier_options": ModifierOptionSyncSerializer(modifier_options, many=True).data,
            }
        )


class SyncOrdersPushView(APIView):
    """POST /api/sync/orders/push/ — bulk, idempotent ตาม Order UUID (rule ข้อ 4)"""

    def post(self, request):
        store_id = request.user.store_id
        results = []

        for order_data in request.data.get("orders", []):
            result = self._push_one(store_id, order_data)
            results.append(result)

        return Response({"results": results})

    @transaction.atomic
    def _push_one(self, store_id, order_data):
        order_id = order_data["id"]
        order = Order.objects.select_for_update().filter(id=order_id).first()
        created = order is None

        if created:
            order = Order.objects.create(
                id=order_id,
                store_id=store_id,
                device_id=order_data["device_id"],
                receipt_number=order_data["receipt_number"],
                order_type=order_data.get("order_type", Order.OrderType.DINE_IN),
                table_id=order_data.get("table_id"),
                customer_name=order_data.get("customer_name"),
                customer_phone=order_data.get("customer_phone"),
                opened_by_id=order_data["opened_by_id"],
                paid_by_id=order_data.get("paid_by_id"),
                status=order_data.get("status", Order.OrderStatus.OPEN),
                session_token=order_data.get("session_token"),
                discount=Decimal(order_data.get("discount", "0.00")),
                subtotal=0,
                total_amount=0,
                payment_method=order_data.get("payment_method"),
                created_at=_parse_dt(order_data.get("created_at"), default=timezone.now()),
                synced_at=timezone.now(),
            )
            if order.table_id and order.order_type == Order.OrderType.DINE_IN:
                # .update() bulk ไม่ trigger auto_now — ต้องระบุ updated_at เอง ไม่งั้นอุปกรณ์อื่น
                # จะ sync ไม่เห็นเพราะ /api/sync/pull/ filter ด้วย updated_at__gt=since
                Table.objects.filter(id=order.table_id).update(
                    status=Table.Status.OCCUPIED, updated_at=timezone.now()
                )
        else:
            # Order เคย sync มาก่อนแล้ว — อัปเดตฟิลด์ระดับ order (LWW ตาม rule ข้อ 7, อุปกรณ์เดียวคุมโต๊ะเดียว
            # ตาม rule ข้อ 7 จึงไม่มีการชนกันจริงจากอุปกรณ์อื่น) และเพิ่มเฉพาะ OrderItem UUID ใหม่ที่ยังไม่เคยมี
            order.status = order_data.get("status", order.status)
            order.discount = Decimal(order_data.get("discount", order.discount))
            order.payment_method = order_data.get("payment_method", order.payment_method)
            order.paid_by_id = order_data.get("paid_by_id", order.paid_by_id)
            order.synced_at = timezone.now()
            order.save(
                update_fields=[
                    "status",
                    "discount",
                    "payment_method",
                    "paid_by_id",
                    "synced_at",
                    "updated_at",
                ]
            )
            if order.table_id and order.status in (
                Order.OrderStatus.PAID,
                Order.OrderStatus.CANCELLED,
            ):
                Table.objects.filter(id=order.table_id).update(
                    status=Table.Status.AVAILABLE, updated_at=timezone.now()
                )

        existing_item_ids = set(
            str(pk) for pk in OrderItem.objects.filter(order=order).values_list("id", flat=True)
        )

        for item_data in order_data.get("items", []):
            if str(item_data["id"]) in existing_item_ids:
                continue  # item นี้ sync ไปแล้วก่อนหน้า ข้าม ไม่สร้างซ้ำ (idempotent ระดับ item)

            item = OrderItem.objects.create(
                id=item_data["id"],
                order=order,
                menu_item_id=item_data["menu_item_id"],
                quantity=item_data.get("quantity", 1),
                unit_price=Decimal(str(item_data["unit_price"])),
                notes=item_data.get("notes"),
                kitchen_status=item_data.get("kitchen_status", OrderItem.KitchenStatus.PENDING),
                channel=item_data.get("channel", OrderItem.Channel.STAFF),
                added_by_id=item_data.get("added_by_id"),
                is_takeaway=item_data.get("is_takeaway", False),
            )
            for mod_data in item_data.get("modifiers", []):
                OrderItemModifier.objects.create(
                    id=mod_data["id"],
                    order_item=item,
                    modifier_option_id=mod_data["modifier_option_id"],
                    extra_price=Decimal(str(mod_data["extra_price"])),
                )

        services.recalculate_order_totals(order)
        status = "created" if created else "updated"
        return {"id": str(order.id), "status": status, "order": OrderSerializer(order).data}
