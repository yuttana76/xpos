from decimal import Decimal

from django.contrib.auth.hashers import make_password
from rest_framework.test import APITestCase

from apps.staff.models import Staff
from apps.tenancy.models import Store


class BaseSyncTestCase(APITestCase):
    def setUp(self):
        self.secret = "test-secret-value"
        self.store = Store.objects.create(
            name="Test Restaurant",
            store_code="TEST01",
            vat_rate=Decimal("7.00"),
            sync_key_hash=make_password(self.secret),
        )
        self.other_store = Store.objects.create(
            name="Other Restaurant",
            store_code="TEST02",
            vat_rate=Decimal("7.00"),
            sync_key_hash=make_password("other-secret"),
        )
        self.staff = Staff.objects.create(
            store=self.store, name="Owner", pin_code_hash=make_password("1234"), role=Staff.Role.OWNER
        )

    def store_sync_headers(self, store_code=None, secret=None):
        store_code = store_code or self.store.store_code
        secret = secret if secret is not None else self.secret
        return {"HTTP_AUTHORIZATION": f"StoreSync {store_code}:{secret}"}


class StoreProvisionPullViewTests(BaseSyncTestCase):
    def test_valid_key_returns_staff_and_store_settings_scoped_to_store(self):
        response = self.client.get("/api/sync/store/pull/", **self.store_sync_headers())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["store_settings"]["id"], str(self.store.id))
        staff_ids = [row["id"] for row in response.data["staff"]]
        self.assertEqual(staff_ids, [str(self.staff.id)])
        self.assertIn("pin_code_hash", response.data["staff"][0])

    def test_wrong_secret_is_rejected(self):
        # DRF ไม่มี authenticate_header() บน StoreSyncKeyAuthentication (เหมือน StaffJWTAuthentication
        # ที่มีอยู่แล้ว) เลย auth failure ทุกแบบตอบ 403 ไม่ใช่ 401 — สอดคล้องกับ pattern เดิมในโปรเจกต์
        response = self.client.get(
            "/api/sync/store/pull/", **self.store_sync_headers(secret="wrong-secret")
        )
        self.assertEqual(response.status_code, 403)

    def test_unknown_store_code_is_rejected(self):
        response = self.client.get(
            "/api/sync/store/pull/", **self.store_sync_headers(store_code="NOPE")
        )
        self.assertEqual(response.status_code, 403)

    def test_no_credential_is_rejected(self):
        response = self.client.get("/api/sync/store/pull/")
        self.assertEqual(response.status_code, 403)

    def test_staff_jwt_cannot_access_store_pull(self):
        from apps.common.jwt_utils import issue_staff_token

        token = issue_staff_token(
            staff_id=self.staff.id,
            store_id=self.staff.store_id,
            device_id="POS01",
            role=self.staff.role,
        )
        response = self.client.get(
            "/api/sync/store/pull/", HTTP_AUTHORIZATION=f"Bearer {token}"
        )
        self.assertEqual(response.status_code, 403)


class SyncOrdersPushViewStoreAuthTests(BaseSyncTestCase):
    def test_store_sync_key_can_push_orders(self):
        response = self.client.post(
            "/api/sync/orders/push/",
            {"orders": []},
            format="json",
            **self.store_sync_headers(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])
