from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Store


class StoreLookupView(APIView):
    """GET /api/public/store/<store_code>/ — ใช้แสดงชื่อร้านยืนยันหน้า login ก่อน submit PIN

    public (AllowAny) เพราะเรียกก่อน login ได้ — คืนแค่ชื่อร้าน ไม่คืนข้อมูลอ่อนไหวอื่น
    (tax_id, address, device_id, customer_order_base_url ฯลฯ)
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, store_code):
        try:
            store = Store.objects.get(store_code=store_code, is_active=True)
        except Store.DoesNotExist:
            return Response({"detail": "ไม่พบร้านค้าจากรหัสร้านนี้"}, status=404)
        return Response({"name": store.name, "store_code": store.store_code})
