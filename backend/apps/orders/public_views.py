from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.floor.models import Table
from apps.menu.models import Category, MenuItem, ModifierOption

from . import services
from .models import Order
from .serializers import OrderSerializer


def _resolve_open_session(session_token):
    """คืน Order ถ้า token ยังใช้งานได้ (status=OPEN + โต๊ะ OCCUPIED ถ้ามีโต๊ะ) มิฉะนั้นคืน None

    ตรวจซ้ำทุกครั้งทั้งตอนเปิดเมนูและตอน submit ออเดอร์ ตาม Self-Order Flow ข้อ 2 และ 4
    """
    order = Order.objects.filter(session_token=session_token).select_related("table").first()
    if order is None:
        return None
    if order.status != Order.OrderStatus.OPEN:
        return None
    if order.table_id and order.table.status != Table.Status.OCCUPIED:
        return None
    return order


def _log_rejected_token(order, session_token):
    if order is not None:
        AuditLog.objects.create(
            store_id=order.store_id,
            staff=None,
            action=AuditLog.Action.SESSION_TOKEN_REJECTED,
            device_id="public",
            target_model="Order",
            target_id=order.id,
            created_at=timezone.now(),
        )


class SelfOrderMenuView(APIView):
    """GET /api/public/order-session/<session_token>/menu/ — public, ไม่ต้อง login"""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, session_token):
        raw_order = Order.objects.filter(session_token=session_token).first()
        order = _resolve_open_session(session_token)
        if order is None:
            _log_rejected_token(raw_order, session_token)
            return Response({"detail": "โต๊ะนี้ปิดแล้ว กรุณาเรียกพนักงาน"}, status=410)

        categories = Category.objects.filter(store_id=order.store_id, is_active=True).prefetch_related(
            "items__modifier_groups__options"
        )
        payload = []
        for category in categories:
            items = category.items.filter(is_active=True, is_available=True)
            payload.append(
                {
                    "category": category.name,
                    "items": [
                        {
                            "id": str(item.id),
                            "name": item.name,
                            "price": str(item.price),
                            "modifier_groups": [
                                {
                                    "id": str(group.id),
                                    "name": group.name,
                                    "is_required": group.is_required,
                                    "options": [
                                        {
                                            "id": str(option.id),
                                            "name": option.name,
                                            "extra_price": str(option.extra_price),
                                        }
                                        for option in group.options.filter(is_active=True)
                                    ],
                                }
                                for group in item.modifier_groups.filter(is_active=True)
                            ],
                        }
                        for item in items
                    ],
                }
            )
        return Response(
            {
                "order_id": str(order.id),
                "table_name": order.table.name if order.table else None,
                "order_type": order.order_type,
                "categories": payload,
            }
        )


class SelfOrderSubmitItemsView(APIView):
    """POST /api/public/order-session/<session_token>/items/ — ส่งตะกร้าทั้งก้อนเดียว"""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, session_token):
        raw_order = Order.objects.filter(session_token=session_token).first()
        order = _resolve_open_session(session_token)
        if order is None:
            _log_rejected_token(raw_order, session_token)
            return Response({"detail": "โต๊ะนี้ปิดแล้ว กรุณาเรียกพนักงาน"}, status=410)

        cart = request.data.get("items", [])
        if not cart:
            return Response({"detail": "ตะกร้าว่างเปล่า"}, status=400)

        for entry in cart:
            menu_item = get_object_or_404(
                MenuItem,
                id=entry.get("menu_item_id"),
                store_id=order.store_id,
                is_active=True,
                is_available=True,
            )
            modifier_options = list(
                ModifierOption.objects.filter(
                    id__in=entry.get("modifier_option_ids", []),
                    group__store_id=order.store_id,
                )
            )
            order, _item = services.add_order_item(
                order_id=order.id,
                menu_item=menu_item,
                quantity=int(entry.get("quantity", 1)),
                notes=entry.get("notes"),
                channel="CUSTOMER",
                added_by=None,
                is_takeaway=False,
                modifier_options=modifier_options,
            )

        return Response(OrderSerializer(order).data, status=201)
