from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.floor.models import Table
from apps.menu.models import MenuItem, ModifierOption

from . import services
from .models import Order, OrderItem
from .serializers import OrderSerializer


def _store_scoped_order(request, order_id):
    # ห้าม trust store_id จาก client — filter ด้วย store_id ที่ผูกกับ JWT เท่านั้น (rule ข้อ 5)
    return get_object_or_404(Order, id=order_id, store_id=request.user.store_id)


def _write_audit_log(request, *, action, target_model, target_id, before=None, after=None):
    AuditLog.objects.create(
        store_id=request.user.store_id,
        staff=request.user.staff,
        action=action,
        device_id=request.user.device_id,
        target_model=target_model,
        target_id=target_id,
        before_data=before,
        after_data=after,
        created_at=timezone.now(),
    )


class OpenTableView(APIView):
    """POST /api/orders/open-table/ — พนักงานเปิดโต๊ะ, gen session_token ใหม่สำหรับ QR (rule ข้อ 10)"""

    def post(self, request):
        table_id = request.data.get("table_id")
        receipt_number = request.data.get("receipt_number")
        if not table_id or not receipt_number:
            return Response({"detail": "table_id, receipt_number จำเป็นต้องระบุ"}, status=400)

        table = get_object_or_404(
            Table, id=table_id, zone__store_id=request.user.store_id, is_active=True
        )
        if table.status != Table.Status.AVAILABLE:
            return Response({"detail": "โต๊ะนี้ไม่ว่าง"}, status=409)

        order = Order.objects.create(
            store_id=request.user.store_id,
            device_id=request.user.device_id,
            receipt_number=receipt_number,
            order_type=Order.OrderType.DINE_IN,
            table=table,
            opened_by=request.user.staff,
            status=Order.OrderStatus.OPEN,
            session_token=services.generate_session_token(),
            subtotal=0,
            total_amount=0,
            created_at=timezone.now(),
        )
        table.status = Table.Status.OCCUPIED
        table.save(update_fields=["status", "updated_at"])

        return Response(OrderSerializer(order).data, status=201)


class OpenTakeawayView(APIView):
    """POST /api/orders/takeaway/ — ไม่มีโต๊ะ ไม่มี session_token (rule ข้อ 11)"""

    def post(self, request):
        receipt_number = request.data.get("receipt_number")
        if not receipt_number:
            return Response({"detail": "receipt_number จำเป็นต้องระบุ"}, status=400)

        order = Order.objects.create(
            store_id=request.user.store_id,
            device_id=request.user.device_id,
            receipt_number=receipt_number,
            order_type=Order.OrderType.TAKEAWAY,
            table=None,
            customer_name=request.data.get("customer_name"),
            customer_phone=request.data.get("customer_phone"),
            opened_by=request.user.staff,
            status=Order.OrderStatus.OPEN,
            session_token=None,
            subtotal=0,
            total_amount=0,
            created_at=timezone.now(),
        )
        return Response(OrderSerializer(order).data, status=201)


class OrderDetailView(APIView):
    """GET /api/orders/<order_id>/ — ดึงสถานะล่าสุด (เผื่อลูกค้า self-order เพิ่มรายการระหว่างนั้น)"""

    def get(self, request, order_id):
        order = _store_scoped_order(request, order_id)
        return Response(OrderSerializer(order).data)


class OpenOrdersView(APIView):
    """GET /api/orders/open/ — order ที่ยังเปิดอยู่ทั้งหมดของร้าน (ทุกโต๊ะ/ทุกอุปกรณ์) ใช้แสดงสถานะครัวที่หน้า floor"""

    def get(self, request):
        orders = Order.objects.filter(
            store_id=request.user.store_id, status=Order.OrderStatus.OPEN
        ).prefetch_related("items__selected_modifiers")
        return Response(OrderSerializer(orders, many=True).data)


def _accessible_stores(request):
    # ร้านหลักที่ JWT ผูกไว้เสมอ + ร้านอื่นที่ authorize เพิ่มไว้ใน DB สำหรับ OWNER เท่านั้น (rule ข้อ 5:
    # ไม่รับ store_id จาก client — คำนวณจากสิทธิ์ฝั่ง server ล้วนๆ)
    accessible_stores = [request.user.staff.store]
    if request.user.role == "OWNER":
        accessible_stores += list(request.user.staff.additional_stores.all())
    return accessible_stores


def _store_summary(store_id, today, month_start):
    paid_today = Order.objects.filter(
        store_id=store_id, status=Order.OrderStatus.PAID, updated_at__date=today
    )
    total_revenue = paid_today.aggregate(total=Sum("total_amount"))["total"] or Decimal("0.00")
    paid_count = paid_today.count()
    average_order_value = (
        (total_revenue / paid_count).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if paid_count
        else Decimal("0.00")
    )
    cash_revenue = (
        paid_today.filter(payment_method="CASH").aggregate(total=Sum("total_amount"))["total"]
        or Decimal("0.00")
    )
    qr_revenue = (
        paid_today.filter(payment_method="QR").aggregate(total=Sum("total_amount"))["total"]
        or Decimal("0.00")
    )
    cancelled_today = Order.objects.filter(
        store_id=store_id, status=Order.OrderStatus.CANCELLED, updated_at__date=today
    ).count()

    paid_this_month = Order.objects.filter(
        store_id=store_id, status=Order.OrderStatus.PAID, updated_at__date__gte=month_start
    )
    monthly_revenue = paid_this_month.aggregate(total=Sum("total_amount"))["total"] or Decimal("0.00")
    monthly_paid_count = paid_this_month.count()

    open_orders = Order.objects.filter(store_id=store_id, status=Order.OrderStatus.OPEN)
    pending_kitchen_items = OrderItem.objects.filter(
        order__in=open_orders, kitchen_status=OrderItem.KitchenStatus.PENDING
    ).count()
    occupied_tables = Table.objects.filter(
        zone__store_id=store_id, status=Table.Status.OCCUPIED
    ).count()

    return {
        "total_revenue": total_revenue,
        "paid_order_count": paid_count,
        "average_order_value": average_order_value,
        "cash_revenue": cash_revenue,
        "qr_revenue": qr_revenue,
        "cancelled_order_count": cancelled_today,
        "monthly_revenue": monthly_revenue,
        "monthly_paid_order_count": monthly_paid_count,
        "open_order_count": open_orders.count(),
        "occupied_table_count": occupied_tables,
        "pending_kitchen_items_count": pending_kitchen_items,
    }


class OrderSummaryView(APIView):
    """GET /api/orders/summary/ — สรุปรายรับวันนี้ + ข้อมูลที่ควรรับทราบ ให้ staff ทุก role เห็นได้

    OWNER ที่ดูแลหลายร้าน (Staff.additional_stores) จะเห็นยอดรวมทุกร้านที่มีสิทธิ์ + breakdown
    แยกรายร้านด้วย — คำนวณจาก store ที่ authorize ไว้ใน DB เท่านั้น ไม่รับ store_id จาก client
    (JWT ของ request นี้ยังผูกกับ store_id เดียวตามปกติ ไม่ได้แก้ scope ของ auth เอง)
    """

    def get(self, request):
        today = timezone.localdate()
        month_start = today.replace(day=1)

        accessible_stores = _accessible_stores(request)

        by_store = []
        totals = {
            "total_revenue": Decimal("0.00"),
            "paid_order_count": 0,
            "cash_revenue": Decimal("0.00"),
            "qr_revenue": Decimal("0.00"),
            "cancelled_order_count": 0,
            "monthly_revenue": Decimal("0.00"),
            "monthly_paid_order_count": 0,
            "open_order_count": 0,
            "occupied_table_count": 0,
            "pending_kitchen_items_count": 0,
        }
        for store in accessible_stores:
            stats = _store_summary(store.id, today, month_start)
            by_store.append(
                {
                    "store_id": str(store.id),
                    "store_name": store.name,
                    "store_code": store.store_code,
                    **{k: str(v) if isinstance(v, Decimal) else v for k, v in stats.items()},
                }
            )
            for key in totals:
                if key in stats:
                    totals[key] += stats[key]

        paid_count = totals["paid_order_count"]
        average_order_value = (
            (totals["total_revenue"] / paid_count).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if paid_count
            else Decimal("0.00")
        )

        return Response(
            {
                "date": today.isoformat(),
                "total_revenue": str(totals["total_revenue"]),
                "paid_order_count": totals["paid_order_count"],
                "average_order_value": str(average_order_value),
                "cash_revenue": str(totals["cash_revenue"]),
                "qr_revenue": str(totals["qr_revenue"]),
                "cancelled_order_count": totals["cancelled_order_count"],
                "monthly_revenue": str(totals["monthly_revenue"]),
                "monthly_paid_order_count": totals["monthly_paid_order_count"],
                "open_order_count": totals["open_order_count"],
                "occupied_table_count": totals["occupied_table_count"],
                "pending_kitchen_items_count": totals["pending_kitchen_items_count"],
                "by_store": by_store,
            }
        )


class OrderTodaySalesView(APIView):
    """GET /api/orders/today-sales/ — รายละเอียดบิลที่ชำระแล้ว "วันนี้" ต่อบิล (โต๊ะ/เวลา/รายการ) รองรับ
    OWNER หลายร้านเหมือน /summary/ — ใช้เปิดจากการคลิก tile รายรับวันนี้ที่หน้า floor
    """

    def get(self, request):
        today = timezone.localdate()
        accessible_stores = _accessible_stores(request)
        store_ids = [s.id for s in accessible_stores]
        store_info_by_id = {
            s.id: {"name": s.name, "address": s.address, "tax_id": s.tax_id} for s in accessible_stores
        }

        orders = (
            Order.objects.filter(
                store_id__in=store_ids, status=Order.OrderStatus.PAID, updated_at__date=today
            )
            .select_related("table")
            .prefetch_related("items__menu_item", "items__selected_modifiers__modifier_option")
            .order_by("-updated_at")
        )

        results = []
        for order in orders:
            store_info = store_info_by_id.get(order.store_id, {})
            results.append(
                {
                    "id": str(order.id),
                    "receipt_number": order.receipt_number,
                    "store_name": store_info.get("name", ""),
                    "store_address": store_info.get("address"),
                    "store_tax_id": store_info.get("tax_id"),
                    "table_name": order.table.name if order.table else None,
                    "order_type": order.order_type,
                    "status": order.status,
                    "payment_method": order.payment_method,
                    "paid_at": order.updated_at.isoformat(),
                    "subtotal": str(order.subtotal),
                    "discount": str(order.discount),
                    "service_charge": str(order.service_charge),
                    "tax_amount": str(order.tax_amount),
                    "total_amount": str(order.total_amount),
                    "items": [
                        {
                            "menu_item_name": item.menu_item.name,
                            "quantity": item.quantity,
                            "unit_price": str(item.unit_price),
                            "modifiers": [m.modifier_option.name for m in item.selected_modifiers.all()],
                            "kitchen_status": item.kitchen_status,
                        }
                        for item in order.items.all()
                    ],
                }
            )

        return Response({"date": today.isoformat(), "orders": results})


class OrderItemsView(APIView):
    """POST /api/orders/<order_id>/items/ — พนักงานสั่งแทนลูกค้า (channel=STAFF)"""

    def post(self, request, order_id):
        order = _store_scoped_order(request, order_id)
        if order.status != Order.OrderStatus.OPEN:
            return Response({"detail": "Order นี้ปิดแล้ว ไม่สามารถเพิ่มรายการได้"}, status=409)

        menu_item = get_object_or_404(
            MenuItem,
            id=request.data.get("menu_item_id"),
            store_id=request.user.store_id,
            is_active=True,
            is_available=True,
        )
        quantity = int(request.data.get("quantity", 1))
        modifier_option_ids = request.data.get("modifier_option_ids", [])
        modifier_options = list(
            ModifierOption.objects.filter(
                id__in=modifier_option_ids, group__store_id=request.user.store_id
            )
        )

        updated_order, item = services.add_order_item(
            order_id=order.id,
            menu_item=menu_item,
            quantity=quantity,
            notes=request.data.get("notes"),
            channel="STAFF",
            added_by=request.user.staff,
            is_takeaway=bool(request.data.get("is_takeaway", False)),
            modifier_options=modifier_options,
        )
        return Response(OrderSerializer(updated_order).data, status=201)

    def delete(self, request, order_id, item_id=None):
        order = _store_scoped_order(request, order_id)
        updated_order, snapshot, was_sent_to_kitchen = services.void_order_item(
            order_id=order.id, item_id=item_id
        )
        if was_sent_to_kitchen:
            _write_audit_log(
                request,
                action=AuditLog.Action.ORDER_ITEM_VOIDED,
                target_model="OrderItem",
                target_id=snapshot["id"],
                before=snapshot,
                after=None,
            )
        return Response(OrderSerializer(updated_order).data)


class OrderItemsSendToKitchenView(APIView):
    """POST /api/orders/<order_id>/items/send-to-kitchen/ — {item_ids} เปลี่ยน PENDING -> SENT (ตอนพิมพ์ใบสั่งครัว)"""

    def post(self, request, order_id):
        order = _store_scoped_order(request, order_id)
        item_ids = request.data.get("item_ids", [])
        updated_order = services.mark_items_sent(order_id=order.id, item_ids=item_ids)
        return Response(OrderSerializer(updated_order).data)


class OrderItemServeView(APIView):
    """POST /api/orders/<order_id>/items/<item_id>/serve/ — เปลี่ยน SENT -> SERVED"""

    def post(self, request, order_id, item_id):
        order = _store_scoped_order(request, order_id)
        updated_order = services.mark_item_served(order_id=order.id, item_id=item_id)
        return Response(OrderSerializer(updated_order).data)


class OrderItemKitchenStatusView(APIView):
    """POST /api/orders/<order_id>/items/<item_id>/kitchen-status/ — {status} ตั้งสถานะครัวตรงๆ (พนักงานแก้ไขเอง)"""

    def post(self, request, order_id, item_id):
        order = _store_scoped_order(request, order_id)
        status = request.data.get("status")
        valid_statuses = {choice[0] for choice in OrderItem.KitchenStatus.choices}
        if status not in valid_statuses:
            return Response({"detail": "status ไม่ถูกต้อง"}, status=400)
        updated_order = services.set_item_kitchen_status(
            order_id=order.id, item_id=item_id, status=status
        )
        return Response(OrderSerializer(updated_order).data)


class OrderDiscountView(APIView):
    """POST /api/orders/<order_id>/discount/ — {amount}"""

    def post(self, request, order_id):
        order = _store_scoped_order(request, order_id)
        if order.status != Order.OrderStatus.OPEN:
            return Response({"detail": "Order นี้ปิดแล้ว"}, status=409)

        amount = Decimal(str(request.data.get("amount", "0")))
        updated_order, before_discount = services.apply_discount(
            order_id=order.id, discount_amount=amount
        )
        _write_audit_log(
            request,
            action=AuditLog.Action.ORDER_DISCOUNT_APPLIED,
            target_model="Order",
            target_id=order.id,
            before={"discount": before_discount},
            after={"discount": str(amount)},
        )
        return Response(OrderSerializer(updated_order).data)


class OrderCancelView(APIView):
    """POST /api/orders/<order_id>/cancel/"""

    def post(self, request, order_id):
        order = _store_scoped_order(request, order_id)
        if order.status != Order.OrderStatus.OPEN:
            return Response({"detail": "ยกเลิกได้เฉพาะ Order ที่ยังเปิดอยู่"}, status=409)

        order.status = Order.OrderStatus.CANCELLED
        order.save(update_fields=["status", "updated_at"])
        if order.table_id:
            order.table.status = Table.Status.AVAILABLE
            order.table.save(update_fields=["status", "updated_at"])

        _write_audit_log(
            request,
            action=AuditLog.Action.ORDER_CANCELLED,
            target_model="Order",
            target_id=order.id,
            before={"status": "OPEN"},
            after={"status": "CANCELLED"},
        )
        return Response(OrderSerializer(order).data)


class OrderPayView(APIView):
    """POST /api/orders/<order_id>/pay/ — {payment_method}"""

    def post(self, request, order_id):
        order = _store_scoped_order(request, order_id)
        if order.status != Order.OrderStatus.OPEN:
            return Response({"detail": "Order นี้ไม่ได้อยู่ในสถานะเปิด"}, status=409)

        order.status = Order.OrderStatus.PAID
        order.paid_by = request.user.staff
        order.payment_method = request.data.get("payment_method")
        order.save(update_fields=["status", "paid_by", "payment_method", "updated_at"])
        if order.table_id:
            order.table.status = Table.Status.AVAILABLE
            order.table.save(update_fields=["status", "updated_at"])

        return Response(OrderSerializer(order).data)
