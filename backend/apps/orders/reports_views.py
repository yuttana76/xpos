from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db.models import Count, DecimalField, ExpressionWrapper, F, Q, Sum, Value
from django.db.models.functions import Coalesce, ExtractHour, TruncDate
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.common.permissions import IsOwnerOrManager
from apps.staff.models import Staff

from .models import Order, OrderItem
from .views import _accessible_stores


def _parse_date_range(request):
    today = timezone.localdate()
    date_from = request.query_params.get("from")
    date_to = request.query_params.get("to")
    try:
        date_from = timezone.datetime.strptime(date_from, "%Y-%m-%d").date() if date_from else today
    except ValueError:
        date_from = today
    try:
        date_to = timezone.datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else today
    except ValueError:
        date_to = today
    return date_from, date_to


def _store_ids(request):
    return [s.id for s in _accessible_stores(request)]


class SalesReportView(APIView):
    """GET /api/orders/reports/sales/?from=YYYY-MM-DD&to=YYYY-MM-DD — สรุปยอดขายช่วงวันที่กำหนดเอง
    (ต่างจาก /api/orders/summary/ ที่ fix แค่วันนี้/เดือนนี้) แยกรายร้านด้วยถ้า OWNER ดูแลหลายร้าน
    """

    permission_classes = [IsOwnerOrManager]

    def get(self, request):
        date_from, date_to = _parse_date_range(request)
        accessible_stores = _accessible_stores(request)

        by_store = []
        totals = {"total_revenue": Decimal("0.00"), "paid_order_count": 0, "cash_revenue": Decimal("0.00"), "qr_revenue": Decimal("0.00")}
        for store in accessible_stores:
            paid = Order.objects.filter(
                store_id=store.id,
                status=Order.OrderStatus.PAID,
                updated_at__date__gte=date_from,
                updated_at__date__lte=date_to,
            )
            revenue = paid.aggregate(total=Sum("total_amount"))["total"] or Decimal("0.00")
            count = paid.count()
            cash = paid.filter(payment_method="CASH").aggregate(total=Sum("total_amount"))["total"] or Decimal("0.00")
            qr = paid.filter(payment_method="QR").aggregate(total=Sum("total_amount"))["total"] or Decimal("0.00")
            by_store.append(
                {
                    "store_id": str(store.id),
                    "store_name": store.name,
                    "store_code": store.store_code,
                    "total_revenue": str(revenue),
                    "paid_order_count": count,
                    "cash_revenue": str(cash),
                    "qr_revenue": str(qr),
                }
            )
            totals["total_revenue"] += revenue
            totals["paid_order_count"] += count
            totals["cash_revenue"] += cash
            totals["qr_revenue"] += qr

        avg = (
            (totals["total_revenue"] / totals["paid_order_count"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if totals["paid_order_count"]
            else Decimal("0.00")
        )

        return Response(
            {
                "from": date_from.isoformat(),
                "to": date_to.isoformat(),
                "total_revenue": str(totals["total_revenue"]),
                "paid_order_count": totals["paid_order_count"],
                "average_order_value": str(avg),
                "cash_revenue": str(totals["cash_revenue"]),
                "qr_revenue": str(totals["qr_revenue"]),
                "by_store": by_store,
            }
        )


class DailySalesReportView(APIView):
    """GET /api/orders/reports/daily-sales/ — ยอดขายรายวัน สำหรับ line chart ที่ใช้ร่วมกันในหน้า
    รายงานต่างๆ (สรุปยอดขาย, ขายดี/ขายไม่ดีตามเมนู, ยอดขายตามเวลา, ยอดขายตามพนักงาน) — รวมทุกร้านที่
    accessible เข้าด้วยกัน ไม่แยกรายร้าน (ตาม pattern เดียวกับ sales-by-hour/sales-by-staff, ต่างจาก
    sales/ ที่มี by_store เพราะ endpoint นั้นมีมาก่อนและหน้านั้นเดียวที่ต้องแยกรายร้าน)

    zero-fill ทุกวันในช่วงที่เลือกเหมือน sales-by-hour zero-fill ทุกชั่วโมง — เพื่อให้เส้นกราฟต่อเนื่อง
    ไม่ขาดหายวันที่ไม่มียอดขาย
    """

    permission_classes = [IsOwnerOrManager]
    MAX_DAYS = 366  # กันช่วงวันที่กว้างเกินไปโดยไม่ตั้งใจทำให้ loop zero-fill ด้านล่างช้า/ค้าง

    def get(self, request):
        date_from, date_to = _parse_date_range(request)
        if (date_to - date_from).days > self.MAX_DAYS:
            date_from = date_to - timedelta(days=self.MAX_DAYS)
        store_ids = _store_ids(request)

        rows = (
            Order.objects.filter(
                store_id__in=store_ids,
                status=Order.OrderStatus.PAID,
                updated_at__date__gte=date_from,
                updated_at__date__lte=date_to,
            )
            .annotate(day=TruncDate("updated_at"))
            .values("day")
            .annotate(total_revenue=Sum("total_amount"), order_count=Count("id"))
        )
        by_day = {r["day"]: r for r in rows}

        results = []
        current = date_from
        while current <= date_to:
            r = by_day.get(current)
            results.append(
                {
                    "date": current.isoformat(),
                    "total_revenue": str(r["total_revenue"]) if r else "0.00",
                    "order_count": r["order_count"] if r else 0,
                }
            )
            current += timedelta(days=1)

        return Response({"from": date_from.isoformat(), "to": date_to.isoformat(), "days": results})


class MenuPerformanceReportView(APIView):
    """GET /api/orders/reports/menu-performance/ — ขายดี/ขายไม่ดี ตามเมนู"""

    permission_classes = [IsOwnerOrManager]

    def get(self, request):
        date_from, date_to = _parse_date_range(request)
        store_ids = _store_ids(request)

        line_total = ExpressionWrapper(F("quantity") * F("unit_price"), output_field=DecimalField())
        rows = (
            OrderItem.objects.filter(
                order__store_id__in=store_ids,
                order__status=Order.OrderStatus.PAID,
                order__updated_at__date__gte=date_from,
                order__updated_at__date__lte=date_to,
            )
            .values("menu_item_id", "menu_item__name")
            .annotate(total_quantity=Sum("quantity"), total_revenue=Sum(line_total), order_count=Count("order", distinct=True))
            .order_by("-total_quantity")
        )

        results = [
            {
                "menu_item_id": str(r["menu_item_id"]),
                "menu_item_name": r["menu_item__name"],
                "total_quantity": r["total_quantity"],
                "total_revenue": str(r["total_revenue"] or Decimal("0.00")),
                "order_count": r["order_count"],
            }
            for r in rows
        ]
        return Response({"from": date_from.isoformat(), "to": date_to.isoformat(), "items": results})


class SalesByHourReportView(APIView):
    """GET /api/orders/reports/sales-by-hour/ — ยอดขายแยกตามชั่วโมง (ดูช่วงพีค)"""

    permission_classes = [IsOwnerOrManager]

    def get(self, request):
        date_from, date_to = _parse_date_range(request)
        store_ids = _store_ids(request)

        rows = (
            Order.objects.filter(
                store_id__in=store_ids,
                status=Order.OrderStatus.PAID,
                updated_at__date__gte=date_from,
                updated_at__date__lte=date_to,
            )
            .annotate(hour=ExtractHour("updated_at"))
            .values("hour")
            .annotate(total_revenue=Sum("total_amount"), order_count=Count("id"))
            .order_by("hour")
        )
        by_hour = {r["hour"]: r for r in rows}
        results = [
            {
                "hour": h,
                "total_revenue": str(by_hour[h]["total_revenue"]) if h in by_hour else "0.00",
                "order_count": by_hour[h]["order_count"] if h in by_hour else 0,
            }
            for h in range(24)
        ]
        return Response({"from": date_from.isoformat(), "to": date_to.isoformat(), "hours": results})


class SalesByStaffReportView(APIView):
    """GET /api/orders/reports/sales-by-staff/ — ยอดขายแยกตามพนักงานที่รับชำระเงิน

    รวมพนักงาน active ทุกคนของร้าน แม้ยอด 0 บาท/ไม่มีบิลเลยในช่วงนี้ก็ตาม (LEFT JOIN แบบมี filter บน
    aggregate) เพื่อให้เจ้าของร้านเห็นว่าใครไม่มียอดขายเลยด้วย ไม่ใช่แค่คนที่มีบิล
    """

    permission_classes = [IsOwnerOrManager]

    def get(self, request):
        date_from, date_to = _parse_date_range(request)
        store_ids = _store_ids(request)

        paid_filter = Q(
            paid_orders__status=Order.OrderStatus.PAID,
            paid_orders__updated_at__date__gte=date_from,
            paid_orders__updated_at__date__lte=date_to,
        )
        rows = (
            Staff.objects.filter(store_id__in=store_ids, is_active=True)
            .annotate(
                total_revenue=Coalesce(
                    Sum("paid_orders__total_amount", filter=paid_filter),
                    Value(Decimal("0.00")),
                    output_field=DecimalField(max_digits=10, decimal_places=2),
                ),
                order_count=Count("paid_orders", filter=paid_filter),
            )
            .order_by("-total_revenue", "name")
        )
        results = [
            {
                "staff_id": str(r.id),
                "staff_name": r.name,
                "total_revenue": str(r.total_revenue or Decimal("0.00")),
                "order_count": r.order_count,
            }
            for r in rows
        ]
        return Response({"from": date_from.isoformat(), "to": date_to.isoformat(), "staff": results})


class DailySalesByStaffReportView(APIView):
    """GET /api/orders/reports/daily-sales-by-staff/ — ยอดขายรายวัน แยกเป็นเส้นต่อพนักงานที่รับชำระเงิน
    สำหรับ line chart หน้า /reports/sales-by-staff โดยเฉพาะ (ต่างจาก daily-sales/ ที่รวมยอดเดียว)

    ต่างจาก sales-by-staff/ (ตาราง) ตรงที่ chart นี้ **ไม่รวมพนักงานที่ไม่มียอดขายเลยในช่วงนี้** — เส้น
    แบนที่ 0 ตลอดทั้งช่วงไม่มีประโยชน์บนกราฟและจะทำให้ legend รกโดยไม่จำเป็น (พนักงานยอด 0 ยังเห็นได้จาก
    ตารางสรุปด้านล่างของหน้าเดิมอยู่แล้ว) และ **จำกัดไม่เกิน 8 เส้น** (เอาเฉพาะ top 7 ตามยอดขายรวม ที่เหลือ
    รวมเป็นเส้น "อื่นๆ") ตาม categorical palette cap ของ dataviz skill — เกิน 8 เส้นแยกสีไม่ออกแล้ว
    """

    permission_classes = [IsOwnerOrManager]
    MAX_DAYS = 366
    MAX_SERIES = 8  # รวม "อื่นๆ" ด้วย ตาม categorical palette cap (8 slot ที่ผ่าน adjacent-pair CVD check)

    def get(self, request):
        date_from, date_to = _parse_date_range(request)
        if (date_to - date_from).days > self.MAX_DAYS:
            date_from = date_to - timedelta(days=self.MAX_DAYS)
        store_ids = _store_ids(request)

        rows = (
            Order.objects.filter(
                store_id__in=store_ids,
                status=Order.OrderStatus.PAID,
                paid_by__isnull=False,
                updated_at__date__gte=date_from,
                updated_at__date__lte=date_to,
            )
            .annotate(day=TruncDate("updated_at"))
            .values("paid_by_id", "paid_by__name", "day")
            .annotate(total_revenue=Sum("total_amount"), order_count=Count("id"))
        )

        by_staff = {}
        staff_names = {}
        staff_totals = {}
        for r in rows:
            sid = r["paid_by_id"]
            staff_names[sid] = r["paid_by__name"]
            by_staff.setdefault(sid, {})[r["day"]] = r
            staff_totals[sid] = staff_totals.get(sid, Decimal("0.00")) + r["total_revenue"]

        # เรียงตามยอดรวมมากไปน้อย เอา top (MAX_SERIES - 1) เป็นเส้นเดี่ยว ที่เหลือรวมเป็น "อื่นๆ"
        ranked_ids = sorted(staff_totals, key=lambda sid: staff_totals[sid], reverse=True)
        top_ids = ranked_ids[: self.MAX_SERIES - 1]
        rest_ids = ranked_ids[self.MAX_SERIES - 1 :]

        def build_days(day_map):
            days = []
            current = date_from
            while current <= date_to:
                r = day_map.get(current)
                days.append(
                    {
                        "date": current.isoformat(),
                        "total_revenue": str(r["total_revenue"]) if r else "0.00",
                        "order_count": r["order_count"] if r else 0,
                    }
                )
                current += timedelta(days=1)
            return days

        series = [
            {"staff_id": str(sid), "staff_name": staff_names[sid], "days": build_days(by_staff[sid])}
            for sid in top_ids
        ]

        if rest_ids:
            merged = {}
            for sid in rest_ids:
                for day, r in by_staff[sid].items():
                    m = merged.setdefault(day, {"total_revenue": Decimal("0.00"), "order_count": 0})
                    m["total_revenue"] += r["total_revenue"]
                    m["order_count"] += r["order_count"]
            series.append({"staff_id": None, "staff_name": "อื่นๆ", "days": build_days(merged)})

        return Response({"from": date_from.isoformat(), "to": date_to.isoformat(), "staff": series})


class DiscountReportView(APIView):
    """GET /api/orders/reports/discounts/ — ประวัติการให้ส่วนลด (จาก AuditLog)"""

    permission_classes = [IsOwnerOrManager]

    def get(self, request):
        date_from, date_to = _parse_date_range(request)
        store_ids = _store_ids(request)
        end = timezone.datetime.combine(date_to + timedelta(days=1), timezone.datetime.min.time())
        end = timezone.make_aware(end) if timezone.is_naive(end) else end
        start = timezone.datetime.combine(date_from, timezone.datetime.min.time())
        start = timezone.make_aware(start) if timezone.is_naive(start) else start

        logs = AuditLog.objects.filter(
            store_id__in=store_ids,
            action=AuditLog.Action.ORDER_DISCOUNT_APPLIED,
            created_at__gte=start,
            created_at__lt=end,
        ).select_related("staff").order_by("-created_at")

        results = []
        for log in logs:
            after_discount = (log.after_data or {}).get("discount")
            # ไม่แสดงรายการที่ส่วนลดกลายเป็น 0 (เช่น พิมพ์เลขแล้วลบทิ้ง ระหว่าง auto-apply ตอนพิมพ์)
            # ไม่ใช่ "การให้ส่วนลด" จริงๆ ที่ควรถูกตรวจสอบ
            try:
                if Decimal(str(after_discount)) <= 0:
                    continue
            except (InvalidOperation, TypeError):
                continue
            results.append(
                {
                    "order_id": str(log.target_id),
                    "staff_name": log.staff.name if log.staff else None,
                    "before_discount": (log.before_data or {}).get("discount"),
                    "after_discount": after_discount,
                    "created_at": log.created_at.isoformat(),
                }
            )
        return Response({"from": date_from.isoformat(), "to": date_to.isoformat(), "discounts": results})


class VoidReportView(APIView):
    """GET /api/orders/reports/voids/ — รายการที่ถูกลบหลังส่งครัวแล้ว (จาก AuditLog) — จุดตรวจสอบการรั่วไหล"""

    permission_classes = [IsOwnerOrManager]

    def get(self, request):
        date_from, date_to = _parse_date_range(request)
        store_ids = _store_ids(request)
        end = timezone.datetime.combine(date_to + timedelta(days=1), timezone.datetime.min.time())
        end = timezone.make_aware(end) if timezone.is_naive(end) else end
        start = timezone.datetime.combine(date_from, timezone.datetime.min.time())
        start = timezone.make_aware(start) if timezone.is_naive(start) else start

        logs = AuditLog.objects.filter(
            store_id__in=store_ids,
            action=AuditLog.Action.ORDER_ITEM_VOIDED,
            created_at__gte=start,
            created_at__lt=end,
        ).select_related("staff").order_by("-created_at")

        results = [
            {
                "order_id": str(log.target_id),
                "staff_name": log.staff.name if log.staff else None,
                "menu_item_name": (log.before_data or {}).get("menu_item"),
                "quantity": (log.before_data or {}).get("quantity"),
                "unit_price": (log.before_data or {}).get("unit_price"),
                "kitchen_status_at_void": (log.before_data or {}).get("kitchen_status"),
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ]
        return Response({"from": date_from.isoformat(), "to": date_to.isoformat(), "voids": results})


class TaxReportView(APIView):
    """GET /api/orders/reports/tax/ — รายงานภาษีขาย (Output Tax Report) สำหรับยื่น ภ.พ.30 ต่อสรรพากร
    มูลค่าก่อนภาษี = subtotal - discount + service_charge, VAT = tax_amount (ตามสูตร rule ข้อ 12:
    Discount -> Service Charge -> VAT)
    """

    permission_classes = [IsOwnerOrManager]

    def get(self, request):
        date_from, date_to = _parse_date_range(request)
        store_ids = _store_ids(request)

        orders = (
            Order.objects.filter(
                store_id__in=store_ids,
                status=Order.OrderStatus.PAID,
                updated_at__date__gte=date_from,
                updated_at__date__lte=date_to,
            )
            .order_by("updated_at")
        )

        results = []
        total_before_vat = Decimal("0.00")
        total_vat = Decimal("0.00")
        for i, order in enumerate(orders, start=1):
            amount_before_vat = order.subtotal - order.discount + order.service_charge
            total_before_vat += amount_before_vat
            total_vat += order.tax_amount
            results.append(
                {
                    "seq": i,
                    "date": order.updated_at.date().isoformat(),
                    "receipt_number": order.receipt_number,
                    "amount_before_vat": str(amount_before_vat),
                    "vat_amount": str(order.tax_amount),
                    "total_amount": str(order.total_amount),
                }
            )

        return Response(
            {
                "from": date_from.isoformat(),
                "to": date_to.isoformat(),
                "total_amount_before_vat": str(total_before_vat),
                "total_vat_amount": str(total_vat),
                "rows": results,
            }
        )
