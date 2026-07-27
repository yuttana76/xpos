import jwt
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from apps.staff.models import Staff

from .jwt_utils import decode_staff_token


class StaffPrincipal:
    """Stand-in for request.user — Staff ไม่ใช่ Django auth User เพราะ login ด้วย PIN ไม่ใช่ password เต็ม"""

    is_authenticated = True
    is_anonymous = False

    def __init__(self, staff, store_id, device_id):
        self.staff = staff
        self.id = staff.id
        self.store_id = store_id  # มาจาก JWT เท่านั้น ไม่ใช่จาก client ตรงๆ (rule ข้อ 5)
        self.device_id = device_id
        self.role = staff.role

    def __str__(self):
        return f"{self.staff.name} @ {self.store_id}"


class StaffJWTAuthentication(BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header.startswith(f"{self.keyword} "):
            return None

        token = header[len(self.keyword) + 1 :]
        try:
            payload = decode_staff_token(token)
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed("token หมดอายุ กรุณาล็อกอินใหม่")
        except jwt.InvalidTokenError:
            raise AuthenticationFailed("token ไม่ถูกต้อง")

        try:
            staff = Staff.objects.get(
                id=payload["staff_id"], store_id=payload["store_id"], is_active=True
            )
        except Staff.DoesNotExist:
            raise AuthenticationFailed("staff ไม่พร้อมใช้งาน (ถูกปิดใช้งานหรือย้ายร้าน)")

        principal = StaffPrincipal(
            staff=staff, store_id=payload["store_id"], device_id=payload["device_id"]
        )
        return (principal, payload)
