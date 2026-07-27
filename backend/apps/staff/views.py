from django.contrib.auth.hashers import check_password
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.common.jwt_utils import issue_staff_token
from apps.tenancy.models import Store

from .models import Staff


class PinLoginView(APIView):
    """POST /api/auth/pin-login/ — {store_code, device_id, pin} -> JWT ผูก store_id/device_id

    store_code เป็นรหัสร้านสั้นๆ ที่ client ใช้ระบุ store ตอนตั้งค่าอุปกรณ์/login เท่านั้น
    (ใช้แทน UUID เพราะพิมพ์/จำง่ายกว่า) หลังจากออก JWT แล้ว ทุก request ถัดไปต้องอ่าน store_id
    จาก JWT เท่านั้น (rule ข้อ 5)
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        store_code = request.data.get("store_code")
        device_id = request.data.get("device_id")
        pin = request.data.get("pin")

        if not store_code or not device_id or not pin:
            return Response(
                {"detail": "store_code, device_id, pin จำเป็นต้องระบุ"}, status=400
            )

        try:
            store = Store.objects.get(store_code=store_code, is_active=True)
        except Store.DoesNotExist:
            return Response({"detail": "ไม่พบร้านค้าจากรหัสร้านนี้"}, status=400)

        staff_match = None
        for candidate in Staff.objects.filter(store_id=store.id, is_active=True):
            if check_password(pin, candidate.pin_code_hash):
                staff_match = candidate
                break

        if staff_match is None:
            AuditLog.objects.create(
                store_id=store.id,
                staff=None,
                action=AuditLog.Action.STAFF_LOGIN_FAILED,
                device_id=device_id,
                target_model="Store",
                target_id=store.id,
                created_at=timezone.now(),
            )
            return Response({"detail": "PIN ไม่ถูกต้อง"}, status=401)

        token = issue_staff_token(
            staff_id=staff_match.id,
            store_id=staff_match.store_id,
            device_id=device_id,
            role=staff_match.role,
        )
        store = staff_match.store
        return Response(
            {
                "token": token,
                "staff": {
                    "id": str(staff_match.id),
                    "name": staff_match.name,
                    "role": staff_match.role,
                },
                # ส่งมาให้ client cache ไว้คำนวณยอดตามสูตร rule ข้อ 12 แบบเดียวกับ server
                # tax_id/address ใช้พิมพ์บนใบเสร็จให้ครบตามข้อกำหนดใบกำกับภาษีอย่างย่อ (มาตรา 86/6)
                "store": {
                    "id": str(store.id),
                    "name": store.name,
                    "vat_rate": str(store.vat_rate),
                    "service_charge_rate": str(store.service_charge_rate),
                    "tax_id": store.tax_id,
                    "address": store.address,
                },
            }
        )
