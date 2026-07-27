from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings

ACCESS_TOKEN_TTL = timedelta(hours=12)  # กะทำงานยาวสุดของพนักงานหน้าร้าน 1 วัน


def issue_staff_token(*, staff_id, store_id, device_id, role):
    now = datetime.now(timezone.utc)
    payload = {
        "staff_id": str(staff_id),
        "store_id": str(store_id),
        "device_id": device_id,
        "role": role,
        "iat": now,
        "exp": now + ACCESS_TOKEN_TTL,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def decode_staff_token(token):
    # jwt.decode ตรวจ exp ให้อัตโนมัติ, raise jwt.ExpiredSignatureError/InvalidTokenError ถ้าไม่ผ่าน
    return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
