from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.audit.models import AuditLog
from apps.common.jwt_utils import issue_staff_token
from apps.floor.models import Table, Zone
from apps.menu.models import Category, MenuItem, ModifierGroup, ModifierOption
from apps.staff.models import Staff
from apps.tenancy.models import Store

from .models import Order


class BaseOrderTestCase(APITestCase):
    def setUp(self):
        self.store = Store.objects.create(
            name="Test Restaurant",
            store_code="TEST01",
            vat_rate=Decimal("7.00"),
            service_charge_rate=Decimal("10.00"),
        )
        self.owner = Staff.objects.create(
            store=self.store, name="Owner", pin_code_hash=make_password("1234"), role=Staff.Role.OWNER
        )
        self.server = Staff.objects.create(
            store=self.store, name="Server", pin_code_hash=make_password("5678"), role=Staff.Role.SERVER
        )
        self.zone = Zone.objects.create(store=self.store, name="Main Hall")
        self.table = Table.objects.create(zone=self.zone, name="T1", seats=4)
        self.category = Category.objects.create(store=self.store, name="Main Dishes")
        self.menu_item = MenuItem.objects.create(
            store=self.store, category=self.category, name="Pad Thai", price=Decimal("100.00")
        )
        self.modifier_group = ModifierGroup.objects.create(store=self.store, name="Spice Level")
        self.modifier_group.menu_items.add(self.menu_item)
        self.modifier_option = ModifierOption.objects.create(
            group=self.modifier_group, name="Extra Spicy", extra_price=Decimal("5.00")
        )

    def auth_headers(self, staff, device_id="POS01"):
        token = issue_staff_token(
            staff_id=staff.id, store_id=staff.store_id, device_id=device_id, role=staff.role
        )
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class PinLoginTests(BaseOrderTestCase):
    def test_login_success_issues_token(self):
        response = self.client.post(
            "/api/auth/pin-login/",
            {"store_code": self.store.store_code, "device_id": "POS01", "pin": "1234"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("token", response.data)

    def test_login_wrong_pin_writes_audit_log(self):
        response = self.client.post(
            "/api/auth/pin-login/",
            {"store_code": self.store.store_code, "device_id": "POS01", "pin": "0000"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertTrue(
            AuditLog.objects.filter(
                store=self.store, action=AuditLog.Action.STAFF_LOGIN_FAILED
            ).exists()
        )


class OpenTableAndOrderFlowTests(BaseOrderTestCase):
    def test_open_table_add_item_calculates_totals_per_rule_12(self):
        headers = self.auth_headers(self.server)
        open_resp = self.client.post(
            "/api/orders/open-table/",
            {"table_id": str(self.table.id), "receipt_number": "POS01-20260724-0001"},
            format="json",
            **headers,
        )
        self.assertEqual(open_resp.status_code, 201)
        order_id = open_resp.data["id"]

        self.table.refresh_from_db()
        self.assertEqual(self.table.status, Table.Status.OCCUPIED)

        item_resp = self.client.post(
            f"/api/orders/{order_id}/items/",
            {
                "menu_item_id": str(self.menu_item.id),
                "quantity": 2,
                "modifier_option_ids": [str(self.modifier_option.id)],
            },
            format="json",
            **headers,
        )
        self.assertEqual(item_resp.status_code, 201)

        # subtotal = (100 + 5) * 2 = 210
        # service_charge = 210 * 10% = 21.00
        # tax = (210 + 21) * 7% = 16.17
        # total = 210 + 21 + 16.17 = 247.17
        data = item_resp.data
        self.assertEqual(Decimal(data["subtotal"]), Decimal("210.00"))
        self.assertEqual(Decimal(data["service_charge"]), Decimal("21.00"))
        self.assertEqual(Decimal(data["tax_amount"]), Decimal("16.17"))
        self.assertEqual(Decimal(data["total_amount"]), Decimal("247.17"))

    def test_void_item_after_sent_to_kitchen_writes_audit_log(self):
        headers = self.auth_headers(self.server)
        order = Order.objects.create(
            store=self.store,
            device_id="POS01",
            receipt_number="POS01-20260724-0002",
            order_type=Order.OrderType.DINE_IN,
            table=self.table,
            opened_by=self.server,
            session_token="tok-void-test",
            subtotal=0,
            total_amount=0,
            created_at=timezone.now(),
        )
        item_resp = self.client.post(
            f"/api/orders/{order.id}/items/",
            {"menu_item_id": str(self.menu_item.id), "quantity": 1},
            format="json",
            **headers,
        )
        item_id = item_resp.data["items"][0]["id"]

        from .models import OrderItem

        OrderItem.objects.filter(id=item_id).update(kitchen_status=OrderItem.KitchenStatus.SENT)

        delete_resp = self.client.delete(
            f"/api/orders/{order.id}/items/{item_id}/", **headers
        )
        self.assertEqual(delete_resp.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(
                store=self.store, action=AuditLog.Action.ORDER_ITEM_VOIDED, target_id=item_id
            ).exists()
        )

    def test_cancel_order_frees_table_and_writes_audit_log(self):
        headers = self.auth_headers(self.server)
        order = Order.objects.create(
            store=self.store,
            device_id="POS01",
            receipt_number="POS01-20260724-0003",
            order_type=Order.OrderType.DINE_IN,
            table=self.table,
            opened_by=self.server,
            session_token="tok-cancel-test",
            subtotal=0,
            total_amount=0,
            created_at=timezone.now(),
        )
        self.table.status = Table.Status.OCCUPIED
        self.table.save()

        resp = self.client.post(f"/api/orders/{order.id}/cancel/", **headers)
        self.assertEqual(resp.status_code, 200)
        self.table.refresh_from_db()
        self.assertEqual(self.table.status, Table.Status.AVAILABLE)
        self.assertTrue(
            AuditLog.objects.filter(
                store=self.store, action=AuditLog.Action.ORDER_CANCELLED, target_id=order.id
            ).exists()
        )


class SelfOrderFlowTests(BaseOrderTestCase):
    def _open_table(self):
        headers = self.auth_headers(self.server)
        resp = self.client.post(
            "/api/orders/open-table/",
            {"table_id": str(self.table.id), "receipt_number": "POS01-20260724-0004"},
            format="json",
            **headers,
        )
        return resp.data

    def test_menu_and_submit_items_combine_with_staff_items(self):
        order_data = self._open_table()
        session_token = order_data["session_token"]

        menu_resp = self.client.get(f"/api/public/order-session/{session_token}/menu/")
        self.assertEqual(menu_resp.status_code, 200)
        self.assertEqual(menu_resp.data["categories"][0]["category"], "Main Dishes")

        submit_resp = self.client.post(
            f"/api/public/order-session/{session_token}/items/",
            {"items": [{"menu_item_id": str(self.menu_item.id), "quantity": 1}]},
            format="json",
        )
        self.assertEqual(submit_resp.status_code, 201)
        self.assertEqual(submit_resp.data["items"][0]["channel"], "CUSTOMER")
        self.assertIsNone(submit_resp.data["items"][0]["added_by"])

    def test_token_rejected_after_payment(self):
        order_data = self._open_table()
        session_token = order_data["session_token"]
        order_id = order_data["id"]
        headers = self.auth_headers(self.owner)

        pay_resp = self.client.post(
            f"/api/orders/{order_id}/pay/", {"payment_method": "CASH"}, format="json", **headers
        )
        self.assertEqual(pay_resp.status_code, 200)

        menu_resp = self.client.get(f"/api/public/order-session/{session_token}/menu/")
        self.assertEqual(menu_resp.status_code, 410)
        self.assertTrue(
            AuditLog.objects.filter(
                store=self.store, action=AuditLog.Action.SESSION_TOKEN_REJECTED
            ).exists()
        )


class SyncPushIdempotencyTests(BaseOrderTestCase):
    def test_pushing_same_order_uuid_twice_is_idempotent(self):
        headers = self.auth_headers(self.server)
        import uuid

        order_id = str(uuid.uuid4())
        payload = {
            "orders": [
                {
                    "id": order_id,
                    "device_id": "POS01",
                    "receipt_number": "POS01-20260724-0099",
                    "order_type": "TAKEAWAY",
                    "opened_by_id": str(self.server.id),
                    "status": "OPEN",
                    "created_at": timezone.now().isoformat(),
                    "items": [
                        {
                            "id": str(uuid.uuid4()),
                            "menu_item_id": str(self.menu_item.id),
                            "quantity": 1,
                            "unit_price": "100.00",
                        }
                    ],
                }
            ]
        }
        first = self.client.post("/api/sync/orders/push/", payload, format="json", **headers)
        self.assertEqual(first.data["results"][0]["status"], "created")

        # push ซ้ำ payload เดิม (order + item UUID เดิม) — order ไม่ถูกสร้างซ้ำ, item ไม่ถูกสร้างซ้ำ
        second = self.client.post("/api/sync/orders/push/", payload, format="json", **headers)
        self.assertEqual(second.data["results"][0]["status"], "updated")

        self.assertEqual(Order.objects.filter(id=order_id).count(), 1)
        order = Order.objects.get(id=order_id)
        self.assertEqual(order.items.count(), 1)  # item UUID เดิม ไม่ถูกสร้างซ้ำ

    def test_pushing_new_item_for_already_synced_order_appends_incrementally(self):
        headers = self.auth_headers(self.server)
        import uuid

        order_id = str(uuid.uuid4())
        first_item_id = str(uuid.uuid4())
        base_order = {
            "id": order_id,
            "device_id": "POS01",
            "receipt_number": "POS01-20260724-0098",
            "order_type": "TAKEAWAY",
            "opened_by_id": str(self.server.id),
            "status": "OPEN",
            "created_at": timezone.now().isoformat(),
        }

        first_payload = {
            "orders": [
                {
                    **base_order,
                    "items": [
                        {
                            "id": first_item_id,
                            "menu_item_id": str(self.menu_item.id),
                            "quantity": 1,
                            "unit_price": "100.00",
                        }
                    ],
                }
            ]
        }
        self.client.post("/api/sync/orders/push/", first_payload, format="json", **headers)

        second_item_id = str(uuid.uuid4())
        second_payload = {
            "orders": [
                {
                    **base_order,
                    "items": [
                        {
                            "id": first_item_id,
                            "menu_item_id": str(self.menu_item.id),
                            "quantity": 1,
                            "unit_price": "100.00",
                        },
                        {
                            "id": second_item_id,
                            "menu_item_id": str(self.menu_item.id),
                            "quantity": 2,
                            "unit_price": "100.00",
                        },
                    ],
                }
            ]
        }
        resp = self.client.post("/api/sync/orders/push/", second_payload, format="json", **headers)
        self.assertEqual(resp.data["results"][0]["status"], "updated")

        order = Order.objects.get(id=order_id)
        self.assertEqual(order.items.count(), 2)  # เพิ่มเฉพาะ item ใหม่ (offline queue เดิมยังใช้ได้ต่อ)
        self.assertEqual(str(order.subtotal), "300.00")  # (1x100) + (2x100)


class AuditLogPermissionTests(BaseOrderTestCase):
    def test_server_role_cannot_view_audit_logs(self):
        headers = self.auth_headers(self.server)
        resp = self.client.get("/api/audit-logs/", **headers)
        self.assertEqual(resp.status_code, 403)

    def test_owner_role_can_view_audit_logs(self):
        headers = self.auth_headers(self.owner)
        resp = self.client.get("/api/audit-logs/", **headers)
        self.assertEqual(resp.status_code, 200)
