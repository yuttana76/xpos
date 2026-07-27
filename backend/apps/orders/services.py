import secrets
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from .models import Order, OrderItem, OrderItemModifier

TWO_PLACES = Decimal("0.01")


def _q(value):
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def generate_session_token():
    return secrets.token_urlsafe(32)


def recalculate_order_totals(order):
    """สูตรตาม Core Architecture Rules ข้อ 12: Discount -> Service Charge -> VAT

    ต้องเรียกภายใน transaction ที่ lock แถว Order ไว้แล้ว (rule ข้อ 13) เพื่อกัน
    lost update เวลามีการ insert OrderItem จากหลายช่องทางพร้อมกัน
    """
    store = order.store
    subtotal = Decimal("0.00")
    items = order.items.prefetch_related("selected_modifiers")
    for item in items:
        line = item.unit_price * item.quantity
        modifiers_total = sum(
            (m.extra_price for m in item.selected_modifiers.all()), Decimal("0.00")
        )
        line += modifiers_total * item.quantity
        subtotal += line

    after_discount = subtotal - order.discount
    service_charge = _q(after_discount * store.service_charge_rate / Decimal("100"))
    tax_amount = _q((after_discount + service_charge) * store.vat_rate / Decimal("100"))
    total_amount = _q(after_discount + service_charge + tax_amount)

    order.subtotal = _q(subtotal)
    order.service_charge = service_charge
    order.tax_amount = tax_amount
    order.total_amount = total_amount
    order.save(
        update_fields=[
            "subtotal",
            "service_charge",
            "tax_amount",
            "total_amount",
            "updated_at",
        ]
    )
    return order


def lock_order(order_id):
    """ต้องเรียกภายใน transaction.atomic() เท่านั้น — ใช้ select_for_update ตาม rule ข้อ 13"""
    return Order.objects.select_for_update().get(id=order_id)


@transaction.atomic
def add_order_item(
    *,
    order_id,
    menu_item,
    quantity,
    notes,
    channel,
    added_by,
    is_takeaway,
    modifier_options,
):
    order = lock_order(order_id)

    item = OrderItem.objects.create(
        order=order,
        menu_item=menu_item,
        quantity=quantity,
        unit_price=menu_item.price,
        notes=notes,
        channel=channel,
        added_by=added_by,
        is_takeaway=is_takeaway,
    )
    for option in modifier_options:
        OrderItemModifier.objects.create(
            order_item=item, modifier_option=option, extra_price=option.extra_price
        )

    recalculate_order_totals(order)
    order.refresh_from_db()
    return order, item


@transaction.atomic
def void_order_item(*, order_id, item_id):
    order = lock_order(order_id)
    item = OrderItem.objects.select_related("menu_item").get(id=item_id, order=order)
    was_sent_to_kitchen = item.kitchen_status != OrderItem.KitchenStatus.PENDING

    snapshot = {
        "id": str(item.id),
        "menu_item": item.menu_item.name,
        "quantity": item.quantity,
        "unit_price": str(item.unit_price),
        "kitchen_status": item.kitchen_status,
    }
    item.delete()
    recalculate_order_totals(order)
    order.refresh_from_db()
    return order, snapshot, was_sent_to_kitchen


@transaction.atomic
def mark_items_sent(*, order_id, item_ids):
    order = lock_order(order_id)
    OrderItem.objects.filter(
        order=order, id__in=item_ids, kitchen_status=OrderItem.KitchenStatus.PENDING
    ).update(kitchen_status=OrderItem.KitchenStatus.SENT, updated_at=timezone.now())
    order.refresh_from_db()
    return order


@transaction.atomic
def mark_item_served(*, order_id, item_id):
    order = lock_order(order_id)
    OrderItem.objects.filter(
        order=order, id=item_id, kitchen_status=OrderItem.KitchenStatus.SENT
    ).update(kitchen_status=OrderItem.KitchenStatus.SERVED, updated_at=timezone.now())
    order.refresh_from_db()
    return order


@transaction.atomic
def set_item_kitchen_status(*, order_id, item_id, status):
    order = lock_order(order_id)
    OrderItem.objects.filter(order=order, id=item_id).update(
        kitchen_status=status, updated_at=timezone.now()
    )
    order.refresh_from_db()
    return order


@transaction.atomic
def apply_discount(*, order_id, discount_amount):
    order = lock_order(order_id)
    before = str(order.discount)
    order.discount = discount_amount
    order.save(update_fields=["discount", "updated_at"])
    recalculate_order_totals(order)
    order.refresh_from_db()
    return order, before
