# xPOS — Restaurant POS System — Current State Specification

> **Purpose of this document:** This is a from-the-ground-truth snapshot of what is *actually implemented* in this repository, written for an AI coding agent (Gemini) picking up development. It supersedes `xpost-spec.md` (the original Phase 1 design doc) wherever the two disagree — this file describes what was actually built, including deviations, fixes, and additions made after the original spec was written. Read `xpost-spec.md` first for the original intent/rationale, then use this file as the authoritative reference for current behavior.

---

## 1. What this project is

A **restaurant POS system**, SaaS-first, **offline-first** on the client. Staff open tables, take orders, send tickets to the kitchen, take payment, and print receipts — all without internet, syncing to the cloud when connectivity returns. Multi-tenant: many stores share one Django/Postgres backend, strictly isolated by `store_id`.

## 2. Tech stack

- **Backend:** Django + Django REST Framework, PostgreSQL. Custom JWT auth (staff PIN login), not Django's built-in auth/User model.
- **Frontend:** Next.js (App Router) + React, TypeScript, Tailwind CSS. PWA (manifest + service worker for app-shell caching).
- **Local offline storage:** Dexie.js (IndexedDB wrapper) — mirrors master data + orders on-device.
- **Local Print Agent:** standalone Node/Express service (`print-agent/`) — bridges the browser to LAN kitchen/receipt printers, since browsers can't open raw TCP sockets.
- **Containerization:** Docker Compose (`db`, `backend`, `frontend`, `nginx`).

Repo layout:
```
backend/          Django project (config/ + apps/)
frontend/         Next.js app (src/app/, src/lib/, src/components/)
print-agent/      Standalone Node print bridge (NOT in docker-compose; run separately)
nginx/            Reverse proxy config (prod)
docker-compose.yml / docker-compose.prod.yml
xpost-spec.md              Original Phase 1 design doc (historical intent)
spec-xpost-gemini.md       This file (current-state reference)
```

Backend apps: `tenancy`, `staff`, `floor`, `menu`, `orders`, `sync`, `audit`, `common`.

---

## 3. Core architecture rules (still true, carried from original spec)

1. **UUIDv4 primary keys everywhere.** Never auto-increment. Prevents ID collisions across offline devices.
2. **Local-first writes.** Order/OrderItem changes write to Dexie first, then push to cloud. Never block the UI on network.
3. **Receipt numbers** are prefixed per device (`POS01-20260726-0001`), counter persisted in Dexie `device_meta`, never reset on app restart.
4. **Incremental sync:** pull only `updated_at__gt=since` rows scoped to the JWT's `store_id`; push is idempotent by Order UUID (existing UUID → update, not duplicate).
5. **Store scoping is server-side only.** Every endpoint must derive `store_id` from the authenticated JWT (`request.user.store_id`), **never** trust a `store_id` from the request body/query string. The one exception is `store_code` at login time (see §6) — that's a lookup key, not a trust boundary.
6. **Soft-delete only on synced master data** (Zone, Table, Category, MenuItem, ModifierGroup, ModifierOption, KitchenPrinter). This is now **enforced structurally**, not just by convention — see §8.3.
7. **Last-Write-Wins** on master data conflicts; one table is expected to be worked by one device at a time (UX-level convention, not DB-enforced).
8. **Kitchen printing goes through Local Print Agent** (`print-agent/server.js`), never direct browser→printer.
9. **Receipt counter persists in Dexie**, per device.
10. **Self-order QR session tokens** are single-use per table-open cycle; invalidated the moment the order is PAID/CANCELLED.
11. **Order type (DINE_IN/TAKEAWAY)** — takeaway never has a table or session_token; dine-in items can be individually flagged `is_takeaway` for "pack to go" sub-orders.
12. **Money calculation order is fixed: Discount → Service Charge → VAT.** Implemented identically in `apps/orders/services.py::recalculate_order_totals` (server) and `frontend/src/lib/calc.ts::calculateOrderTotals` (client offline estimate). **Never reorder these steps.**
13. **Concurrency:** every order-total recalculation happens inside `transaction.atomic()` with `select_for_update()` on the Order row.

---

## 4. Data models (current, with deltas from original spec)

### `apps/tenancy/models.py` — `Store`
```python
id, store_code (unique, short human code e.g. "XPOS01"),
name, tax_id (nullable), address (nullable),
vat_rate (default 7.00), service_charge_rate (default 0.00),
is_active, updated_at
```
**Delta from original spec:** added `store_code` (see §6), `address` (added for Thai receipt compliance, §11).

### `apps/staff/models.py` — `Staff`
```python
id, store (FK), name, pin_code_hash, role (OWNER/MANAGER/CASHIER/SERVER),
additional_stores (M2M to Store, blank=True),
is_active, updated_at
```
**Delta:** `additional_stores` added to support **one Owner viewing combined reports across multiple stores** without changing JWT/auth scoping (§10). A Staff's `store` FK is still their one PIN-login home; `additional_stores` only affects report aggregation, checked server-side, never trusted from the client.

### `apps/floor/models.py` — `Zone`, `Table` — unchanged from original spec.

### `apps/menu/models.py` — `KitchenPrinter`, `Category`, `MenuItem`, `ModifierGroup`, `ModifierOption` — unchanged from original spec. Note: `ModifierGroup` currently has no "max selections" field — the frontend enforces "pick exactly one per group" as a UI convention (radio buttons), not a DB constraint.

### `apps/orders/models.py` — `Order`, `OrderItem`, `OrderItemModifier` — unchanged from original spec.

### `apps/audit/models.py` — `AuditLog` — unchanged from original spec. Actions currently written by the app: `ORDER_CANCELLED`, `ORDER_ITEM_VOIDED` (only when the voided item had already left PENDING status), `ORDER_DISCOUNT_APPLIED`, `STAFF_LOGIN_FAILED`. Not yet wired up: `TABLE_STATUS_OVERRIDE`, `MENU_PRICE_CHANGED`, `MASTER_DATA_DEACTIVATED`, `SESSION_TOKEN_REJECTED`, `SYNC_CONFLICT_RESOLVED`, `SYNC_IDEMPOTENT_REJECT` (these choices exist in the model but nothing writes them yet — a gap if you need that audit coverage).

---

## 5. Authentication

- **Login is PIN + `store_code`**, not username/password. `POST /api/auth/pin-login/` body: `{store_code, device_id, pin}`.
  - Looks up `Store` by `store_code`, then scans that store's active `Staff` checking `pin_code_hash` via `django.contrib.auth.hashers.check_password`.
  - Returns `{token, staff: {id, name, role}, store: {id, name, vat_rate, service_charge_rate, tax_id, address}}`.
- JWT payload: `{staff_id, store_id, device_id, role, iat, exp}` (12h TTL). `store_id` here is the UUID — **this is the only store_id the rest of the API ever trusts**, regardless of what `store_code` was used to log in.
- `apps/common/authentication.py::StaffJWTAuthentication` decodes the token, re-fetches the live `Staff` row (`is_active=True`, matching `store_id`) on every request — a deactivated staff member is locked out immediately, no waiting for token expiry.
- Permissions (`apps/common/permissions.py`):
  - `IsOwnerOrManager` — role in (OWNER, MANAGER)
  - `IsOwner` — role == OWNER only
  - Most endpoints have no explicit `permission_classes` (any authenticated staff), a few are `AllowAny` (pin-login itself, public self-order endpoints).

---

## 6. Store identification: `store_code` vs `store_id`

Originally devices were configured with the Store's raw UUID (`storeId` in `DeviceConfig`). This was replaced with a short, human-typeable `store_code` (e.g. `XPOS01`) because staff were mistyping/pasting the wrong values on `/setup`. **Current flow:**
- `/setup` page collects `apiBaseUrl`, `storeCode`, `deviceId` → stored in `localStorage` under `xpos.device` (see `frontend/src/lib/session.ts`).
- `pin-login` request body uses `store_code`, not `store_id`.
- Devices configured under the *old* schema (`storeId` field, no `storeCode`) are detected on `/login` (`!device.storeCode`) and bounced to `/setup` automatically.

---

## 7. Full REST API reference (current)

All paths are under the Django root; see `config/urls.py` for the mount points.

### Auth — `apps.staff` (`/api/auth/`)
- `POST pin-login/` — see §5.

### Orders — `apps.orders` (`/api/orders/`)
- `POST open-table/` — `{table_id, receipt_number}` → creates DINE_IN order, generates `session_token`, marks table OCCUPIED.
- `POST takeaway/` — `{receipt_number, customer_name?, customer_phone?}` → TAKEAWAY order, no table/token.
- `GET open/` — all OPEN orders (with items) for accessible store(s) — powers the `/floor` kitchen-status panel across devices.
- `GET summary/` — today's + this-month's revenue/order-count/cash-vs-QR, **aggregated across all accessible stores** for OWNER role (see §10). Open to **every** role (deliberately, per product decision — daily summary is not owner-only).
- `GET today-sales/` — today's PAID orders in full detail (items, modifiers, kitchen_status, store, table, time), sorted newest-first. Powers `/reports/today`.
- `GET reports/sales/?from&to` — like `summary/` but for an arbitrary date range. **`IsOwnerOrManager`.**
- `GET reports/menu-performance/?from&to` — item sell-through (qty, revenue, order_count) per menu item. `IsOwnerOrManager`.
- `GET reports/sales-by-hour/?from&to` — revenue/order-count bucketed by hour-of-day (0–23, Bangkok tz). `IsOwnerOrManager`.
- `GET reports/sales-by-staff/?from&to` — revenue per staff who **received payment** (`paid_by`). **Includes every active staff member, even those with zero sales** (LEFT JOIN semantics via `Coalesce` — see the gotcha in §12.4). `IsOwnerOrManager`.
- `GET reports/discounts/?from&to` — discount events from `AuditLog` (`ORDER_DISCOUNT_APPLIED`), **filtered to exclude entries where the final discount is 0** (debounced auto-apply can log no-op zero states). `IsOwnerOrManager`.
- `GET reports/voids/?from&to` — voided items from `AuditLog` (`ORDER_ITEM_VOIDED`) — only items voided *after* leaving PENDING (i.e. after being sent to kitchen); pre-kitchen voids are not logged (by design, not a bug). `IsOwnerOrManager`.
- `GET reports/tax/?from&to` — Thai Revenue Department "รายงานภาษีขาย" (Output Tax Report, ภ.พ.30 support): per-order row with `amount_before_vat` (= subtotal − discount + service_charge), `vat_amount`, `total_amount`. `IsOwnerOrManager`. Frontend offers CSV export.
- `GET <order_id>/` — order detail with items.
- `POST <order_id>/items/` — staff adds an item (`channel=STAFF`).
- `DELETE <order_id>/items/<item_id>/` — void an item (hard delete of the row; audit-logged only if it had left PENDING).
- `POST <order_id>/items/send-to-kitchen/` — `{item_ids}`, PENDING→SENT for those items (used by the "print to kitchen" button; see §11).
- `POST <order_id>/items/<item_id>/serve/` — SENT→SERVED (forward-only).
- `POST <order_id>/items/<item_id>/kitchen-status/` — `{status}`, **sets kitchen_status to any value directly** (manual staff correction, no transition restriction) — used by the item edit modal's status dropdown.
- `POST <order_id>/discount/` — `{amount}` (always a flat currency amount; the frontend converts % to currency client-side before calling this).
- `POST <order_id>/cancel/` — OPEN→CANCELLED, frees the table.
- `POST <order_id>/pay/` — `{payment_method}`, OPEN→PAID, frees the table.

### Public self-order — `apps.orders.public_urls` (`/api/public/order-session/`)
- `GET <session_token>/menu/`
- `POST <session_token>/items/`

(Both `AllowAny`, validate token liveness + Order/Table status per original spec §"Self-Order Flow".)

### Floor management — `apps.floor` (`/api/floor/`) — **new since original spec**
DRF `DefaultRouter`-backed CRUD, `IsOwner` only:
- `zones/` — list/create/retrieve/update (no delete — see §8.3)
- `tables/` — same, validates the target `zone` belongs to the caller's store

### Menu management — `apps.menu` (`/api/menu/`) — **new since original spec**
Same pattern, `IsOwner` only:
- `categories/`, `items/`, `kitchen-printers/`

### Sync — `apps.sync` (`/api/sync/`)
- `GET pull/?since=<ISO8601>` — master data delta (zones, tables, printers, categories, menu_items, modifier_groups, modifier_options). **Does not and cannot signal hard-deletes** — see §12.3, this is why floor/menu CRUD disallows DELETE.
- `POST orders/push/` — bulk idempotent order push (see original spec + §12.2 gotcha about bulk `.update()`).

### Audit — `apps.audit` (`/api/`)
- `audit-logs/` — read-only ViewSet, `IsOwnerOrManager`, store-scoped.

---

## 8. Backend implementation patterns worth knowing

### 8.1 `_accessible_stores(request)` (in `apps/orders/views.py`)
Central helper: returns `[request.user.staff.store] + list(additional_stores.all())` if role is OWNER, else just the home store. Every multi-store-aware report/endpoint calls this — **don't duplicate this logic**, import it.

### 8.2 `SoftDeleteModelViewSet` (`apps/common/viewsets.py`)
```python
class SoftDeleteModelViewSet(
    mixins.CreateModelMixin, mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin, mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """No DestroyModelMixin — see docstring in the file for why."""
```
All of `ZoneViewSet`, `TableViewSet`, `CategoryViewSet`, `MenuItemViewSet`, `KitchenPrinterViewSet` inherit this instead of `viewsets.ModelViewSet`. **`DELETE` returns 405 on all of them, on purpose.** Deactivate via `PATCH {is_active: false}` instead. (See §12.3 for why this exists.)

### 8.3 Why hard-delete is banned on synced master data
The incremental pull sync (`updated_at__gt=since`) has **no mechanism to tell a client "this record was deleted"** — a hard-deleted row just vanishes from future pulls, but clients that already cached it keep it forever (no tombstone). This bit us for real during development: a test `Zone` was hard-deleted via Django shell and stayed "ghost"-visible in a browser's Dexie cache indefinitely. Fix applied: (1) `SoftDeleteModelViewSet` structurally prevents this via the API, (2) if you ever must hard-delete via shell/admin for cleanup, you must also manually bump `updated_at` on ideally the *entire* affected table via `Model.objects.update(updated_at=timezone.now())` won't help for deletions (nothing to bump) — **the only real fix for a bad hard-delete is clearing the affected client's IndexedDB.** Don't hard-delete synced master data. Ever.

### 8.4 Bulk `.update()` does not trigger `auto_now`
`SomeModel.objects.filter(...).update(status=X)` does **not** run Django's `auto_now` logic on `updated_at` (unlike `.save()`). This broke incremental sync twice during development (table status corrections silently invisible to other devices). **Rule: any bulk `.update()` on a model with `updated_at = auto_now=True` used anywhere in a sync-relevant path must explicitly include `updated_at=timezone.now()` in the `.update()` kwargs.** See `apps/sync/views.py` `_push_one` for the pattern (comment left in place as a warning).

### 8.5 UUID vs string comparison gotcha
`some_fk.store_id` (from a loaded model instance) is a Python `uuid.UUID` object; `request.user.store_id` (from the JWT payload) is a `str`. Comparing them with `!=` is **always True** even when they represent the same store — a real bug hit during floor/menu CRUD development (validation always rejected valid same-store data). **Always `str()` both sides before comparing manually.** Django ORM `.filter(store_id=x)` is safe either way (the ORM coerces at the SQL level); it's only bare Python `==`/`!=` comparisons outside a queryset that are at risk.

### 8.6 `NULL` sorts first in `ORDER BY ... DESC` (Postgres)
When aggregating with a `filter=Q(...)` on `Sum`/`Count` (used for "show every X even with zero activity" reports, e.g. sales-by-staff), unmatched rows produce SQL `NULL`, not `0`. Postgres sorts `NULL` **before** all values in `DESC` order, so a zero-activity row jumps to the *top* instead of the bottom. Fix: wrap the aggregate in `Coalesce(Sum(...), Value(Decimal("0.00")), output_field=DecimalField(...))` before sorting by it.

### 8.7 Menu-item `version` field
Bumped by 1 on every `MenuItemViewSet` update (`perform_update`), for future client-side cache-busting. Not currently read by any frontend code, but keep bumping it — don't remove.

---

## 9. Frontend structure

### Routes (`frontend/src/app/`)
```
/                          → redirect logic (device? session? → /setup | /login | /floor)
/setup                     → device config (apiBaseUrl, storeCode, deviceId) → localStorage
/login                     → PIN pad; also has a "เปลี่ยนร้าน / ตั้งค่าอุปกรณ์" link → /setup
/floor                     → table grid + kitchen-status panel + revenue summary tiles (role-aware)
/takeaway/new              → new takeaway order form
/orders/[orderId]          → the core order-taking screen (add/edit items, modifiers, discount,
                             send-to-kitchen, pay, cancel) — see §11
/order-session/[token]     → PUBLIC customer-facing self-order menu (no login)
/audit                     → AuditLog viewer (OWNER/MANAGER)
/manage                    → Zone/Table/Category/MenuItem CRUD UI (OWNER only) — see §13
/reports                   → hub page listing all reports by category (also reachable via
                             expandable Sidebar sub-menu — see §14)
/reports/today             → today's paid orders in detail, open to all roles
/reports/sales             → date-range revenue summary, OWNER/MANAGER
/reports/menu-performance  → best/worst sellers, OWNER/MANAGER
/reports/sales-by-hour     → hourly revenue bar chart, OWNER/MANAGER
/reports/sales-by-staff    → revenue per staff (incl. zero-sales staff), OWNER/MANAGER
/reports/discounts         → discount audit log, OWNER/MANAGER
/reports/voids             → post-kitchen void audit log, OWNER/MANAGER
/reports/tax               → Thai sales tax report + CSV export, OWNER/MANAGER
```

### Session/device state (`frontend/src/lib/session.ts`)
`localStorage` keys `xpos.device` (`DeviceConfig`: `apiBaseUrl, storeCode, deviceId`) and `xpos.session` (`StaffSession`: `token, staff {id,name,role}, store {id,name,vat_rate,service_charge_rate,tax_id,address}`). No cookies, no server sessions — everything is the JWT in `xpos.session` sent as `Authorization: Bearer`.

### `frontend/src/lib/api.ts`
Thin fetch wrapper: `api.get/post/patch/del`. Throws `ApiError` (with `.status`) on non-2xx. Base URL comes from `device.apiBaseUrl`.

### Dexie schema (`frontend/src/lib/db.ts`)
Mirrors master data + orders. See file for the full table list — unchanged in shape from original spec's intent, just confirmed accurate as of this writing (§4 above lists the source-of-truth Django models; Dexie interfaces mirror them field-for-field).

### `frontend/src/components/Sidebar.tsx`
Persistent left nav (desktop: static column; mobile: hamburger + slide-over drawer with backdrop). Role-filtered nav items. Contains an **expandable "รายงาน" sub-menu** (auto-expands if the current route is a report sub-page), grouped by category (ยอดขาย / ตรวจสอบ / ภาษี) matching the `/reports` hub categorization. Hidden entirely on `/`, `/login`, `/setup`, `/order-session/*`.

### `frontend/src/components/DateRangePicker.tsx`
Shared by every `/reports/*` sub-page except `/reports/today` (which is always "today" specifically). Quick presets (วันนี้/สัปดาห์นี้/เดือนนี้) + manual `<input type="date">` from/to.

### `frontend/src/lib/print.ts` + `print-agent/server.js`
`printAgent.printKitchenTicket(job)` / `printAgent.printReceipt(job)` — POSTs to `http://localhost:9100/print`. **Every print job is also logged in full to the browser console** (prefixed `[print]`) regardless of whether the agent responds, specifically so development/no-hardware testing can verify content without a physical printer. The print-agent itself logs to `print-agent/print-log.txt` and stdout; runs in mock mode unless `ENABLE_REAL_PRINTING=true`. **It is a standalone Node process, not in docker-compose — it does not hot-reload; restart it manually after editing `print-agent/server.js`.**

---

## 10. Multi-store reporting (Owner viewing several branches)

Deliberately **did not** touch JWT/auth scoping (still one store per session, per original rule §5). Instead:
- `Staff.additional_stores` (M2M) lets one Owner identity be authorized to view (not operate) other stores' data.
- `_accessible_stores(request)` expands to home store + `additional_stores` only when `role == OWNER`.
- Every report endpoint that supports this returns a `by_store` breakdown array alongside the combined total, so the frontend can show "(N ร้าน)" and a per-store table only when `by_store.length > 1` — **fully backward compatible** for single-store owners (they just get one row, same numbers as before this feature existed).
- Configure via Django admin: Staff → (edit an OWNER) → "Additional stores" (uses `filter_horizontal`).

---

## 11. Order detail page (`/orders/[orderId]`) — feature summary

This is the most feature-dense page; a lot of iteration happened here.

- **Add item modal:** quantity stepper + per-`ModifierGroup` **single-select (radio)** options (not checkboxes — a deliberate correction from an earlier multi-select version), required groups block confirmation until satisfied. Shows a **live-updating unit-price × qty = total** preview as you adjust quantity/modifiers.
- **Edit item:** re-opens the same modal pre-filled. If quantity/modifiers are unchanged but `kitchen_status` is changed via the dropdown, it's applied **in place** (`.../kitchen-status/` endpoint, no re-creation). If content *did* change, the old item is voided and a new one created (existing immutable-line-item architecture) — the new item always starts at PENDING regardless of what the status dropdown said, since changed content genuinely needs re-cooking.
- **Send to kitchen:** single button, always enabled once the order has any item. Prints **all current items grouped by menu category** (not just newly-added ones) to that category's assigned `KitchenPrinter` (or "N/A" if unset), then marks any still-PENDING items SENT. If nothing is PENDING when pressed, it **reprints** everything already sent instead (ticket header gets a "(พิมพ์ซ้ำ)" suffix) — one button covers both send and reprint, no separate reprint UI.
- **Discount:** flat-amount or percentage toggle (฿/%), **applies live as you type** (600ms debounce), no separate "apply" button. Percentage is converted to currency client-side from current subtotal before hitting `/discount/`. On page load, syncs the input from the order's actual stored discount once (a ref guards against the debounce effect clobbering it back to the initial "0").
- **Payment:** confirm modal shows the full breakdown before charging; on confirm, prints a receipt immediately (no forced preview — see product rationale in §"design notes" below) meeting Thai tax-invoice requirements (see §12.1... err, §16).
- **Missing-order handling:** every mutating action (pay/cancel/void/etc.) checks for a 404 (`ApiError.status === 404`) specifically and, if hit, clears the stale local Dexie copy and shows a dedicated "ไม่พบออเดอร์นี้บน server แล้ว" screen with a button back to `/floor` — instead of a generic error the user can't escape. This matters because orders *can* legitimately vanish from a client's perspective (e.g. cancelled from another device) faster than the 5s poll notices.

**Design note on preview-before-print:** deliberately **no mandatory preview during live payment** (matches how fast-moving POS systems like Square/Toast behave — the payment-confirm modal already serves as the review step, and a forced receipt preview would slow down the line). A **receipt preview modal *does* exist for reprints** (`/reports/today`, per-order "🖨 พิมพ์ใบเสร็จอีกครั้ง" button) since reprints aren't time-pressured and the preview doubles as an on-screen view when no physical printer is attached.

---

## 12. Thai tax compliance on receipts

Per กรมสรรพากร ประมวลรัษฎากร มาตรา 86/6 (simplified/abbreviated tax invoice requirements). The receipt (both the physical/logged print and the on-screen reprint preview) includes:
- Header: "ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ"
- Store name, address (`Store.address`), tax ID (`Store.tax_id`) — **must be filled in via Django admin** for these to appear (they're optional fields, blank by default).
- Receipt number, issue date/time, table or "Takeaway", payment method.
- Itemized lines with modifiers, then Subtotal / Discount / Service Charge / VAT / TOTAL in that fixed order (matches §3 rule 12).
- Retention: PAID orders are never deleted (no delete endpoint exists on Order at all), satisfying the ≥5-year retention rule from the original spec.
- The `/reports/tax` report + CSV export exists specifically to support ภ.พ.30 monthly VAT filing (not automatic filing — a human still has to submit it, this just produces the input data).

---

## 13. `/manage` — Owner self-service floor/menu configuration

Before this existed, Zone/Table/Category/MenuItem could only be edited via Django admin. `/manage` (OWNER-only, linked from Sidebar) has two tabs:
- **ผังร้าน (Floor):** add zones, add tables per zone, inline-edit name/seats, toggle `is_active` — all auto-saving on change (no explicit save button).
- **เมนู (Menu):** add categories (with kitchen-printer assignment dropdown), add menu items per category, inline-edit name/price/`is_available`/`is_active`.

Everything here goes through the `SoftDeleteModelViewSet`-backed APIs in §7 — there is no delete button in this UI, only deactivate toggles, matching §8.3.

---

## 14. Sidebar navigation summary

Always-visible items (role-filtered): ผังโต๊ะ, + Takeaway, รายรับวันนี้ (all roles), Audit Log (OWNER/MANAGER), ตั้งค่าร้าน (OWNER), **รายงาน** (OWNER/MANAGER — expandable sub-menu, see §9). Logout button at the bottom. Store name + staff name/role shown at the top. Fully responsive (see §9 Sidebar component note).

---

## 15. Known gaps / explicitly out of scope right now

Carried over from the original spec's Phase 2 table (still not done): Split payment, real-time KDS, Promotion/Loyalty. Additionally, discovered during this build:
- No inventory/stock management at all.
- `AuditLog` actions `TABLE_STATUS_OVERRIDE`, `MENU_PRICE_CHANGED`, `MASTER_DATA_DEACTIVATED`, `SESSION_TOKEN_REJECTED`, `SYNC_CONFLICT_RESOLVED`, `SYNC_IDEMPOTENT_REJECT` are defined but never written — if you need audit coverage for those events, you must add the `AuditLog.objects.create(...)` calls at the relevant call sites.
- `ModifierGroup` has no "max selections" DB constraint — single-select is a frontend convention only; a direct API call could still attach multiple `OrderItemModifier` rows to one item.
- Weekly/monthly aggregate reports use the same generic date-range report (`/reports/sales`) rather than dedicated week/month views — this was judged sufficient rather than building separate endpoints.
- No automated test coverage was added for the new `/api/orders/reports/*` endpoints or the `/api/floor/`, `/api/menu/` CRUD endpoints (only manually verified via curl + Playwright browser sessions during development). The existing Django test suite (`apps/orders/tests.py`, 11 tests) still passes but does not cover this new surface area.
- `print-agent` has no auto-restart/watch mode — see §9 warning.

---

## 16. If you're picking this up cold

1. `docker compose up -d` brings up db/backend/frontend/nginx. `print-agent/` is separate: `cd print-agent && node server.js` (optionally `ENABLE_REAL_PRINTING=true`).
2. Seed data: `python manage.py seed_demo` (inside the backend container) creates a demo store with `store_code=XPOS01`, an owner (PIN `1111`) and server (PIN `2222`).
3. To test as an Owner with multiple stores, create a second `Store` + `Staff`, then add it to the first owner's `additional_stores` via Django admin.
4. Backend tests: `python manage.py test` (fast, ~2s, 11 tests — all in `apps/orders/tests.py`).
5. When adding any new synced master-data model or endpoint: inherit `SoftDeleteModelViewSet`, scope via JWT `store_id` (never trust client-supplied store IDs), and if you ever bulk-`.update()` rows that matter to sync, remember to bump `updated_at` explicitly (§8.4).

---

## 17. Multi-store cloud sync — local-per-store deployment

**Why this exists:** §1–§16 describe offline-first at the *browser/device* level only —
each device mirrors master data into its own Dexie/IndexedDB, but cross-device
consistency within one store (e.g. the `/floor` kitchen-status panel via `GET
/api/orders/open/`) still requires hitting the shared cloud backend. If a store's
internet drops and it runs multiple terminals, those terminals stop seeing each
other's live state until connectivity returns. §17 adds a second, independent
deployment mode that fixes this: run the **full stack on the store's own LAN**, so the
store operates 100% normally — including cross-terminal consistency — with or without
internet, and only push/pull to a central cloud a few times a day purely so the owner
can review data remotely.

### 17.1 Cloud vs. store deployment

No new compose file was added. The two existing files now have distinct roles:
- **`docker-compose.prod.yml`** — the **cloud** deployment (public HTTPS, one shared
  Postgres, what §1–§16 always assumed).
- **`docker-compose.yml`** — already LAN-only (`localhost` ports, no TLS); this is now
  also the **store** deployment. A store runs this on a machine on its own LAN with
  its own local Postgres. It is the *same Django image* as the cloud — behavior
  differs only by which optional env vars are set (`CLOUD_API_URL`, `CLOUD_SYNC_KEY`)
  and which services are actually doing anything.

A store-local Postgres holds exactly one store's data; none of the local-side sync
code filters by `store_id` because there's only ever one.

### 17.2 Design decisions (confirmed, not to be re-litigated casually)

- **Master data (menu/floor/staff) is authored centrally at the cloud and pulled down
  into each store** — not edited locally and pushed up. A store's `/manage` UI still
  works against its local backend for *display*, but the source of truth for
  menu/floor/staff is the cloud; local edits to those models are not part of this
  sync (out of scope — if that's ever needed it requires a master-data push endpoint
  and a conflict-resolution policy, deliberately not built here).
- **Scheduling uses Celery beat + Redis**, not a bare loop/cron, for built-in
  retry/monitoring when the upstream HTTP call fails.
- Because every model already uses UUIDv4 PKs (rule #1) and `SyncOrdersPushView` was
  already idempotent-by-UUID (rule #4), many independent per-store Postgres databases
  push into one shared cloud Postgres database with no ID-collision risk and no new ID
  scheme.
- No FK-ordering/conflict problem on push: any menu item/table/staff UUID an order
  references was itself pulled from the cloud first, so it already exists cloud-side
  before the order push ever references it.

### 17.3 Sync flow

Both directions reuse existing `apps/sync` endpoints/logic almost unchanged:

1. **Cloud → Store (pull).** The store's Celery task calls `GET
   /api/sync/store/pull/?since=...` (new — `StoreProvisionPullView`). This returns
   everything `SyncPullView` already returns (zones/tables/printers/categories/
   menu_items/modifier_groups/modifier_options via the shared `_master_data_since()`
   helper) **plus** `staff` (so PIN login works locally even offline — includes
   `pin_code_hash`, which is why this is a separate endpoint from the device-facing
   `SyncPullView` and requires `StoreSync` auth, never staff JWT) and `store_settings`
   (vat_rate, tax_id, address, etc). The store applies it as upsert-by-UUID into its
   own local Postgres (`apps/sync/upstream.py::apply_master_data_payload`, in FK
   dependency order: store → staff → zones → kitchen_printers → tables → categories →
   menu_items → modifier_groups (+ M2M) → modifier_options).
2. **Store → Cloud (push).** The store's Celery task POSTs locally-changed
   Orders/OrderItems to the cloud's existing `POST /api/sync/orders/push/` — same
   view, same idempotent-by-UUID body, unchanged. It now also accepts `StoreSync` auth
   in addition to staff JWT (both derive `store_id` from the authenticated principal,
   never from the payload — rule #5 still holds).

### 17.4 New auth: `StoreSyncKeyAuthentication`

`apps/common/authentication.py`. Header `Authorization: StoreSync
<store_code>:<secret>` — a machine-to-machine credential distinct from staff PIN JWT,
used only by a store's own backend talking to the cloud (never by browsers). Looks up
`Store` by `store_code` (existing unique field), verifies `secret` against
`Store.sync_key_hash` via `check_password` (same hashing convention as staff PINs).
Produces a `StoreSyncPrincipal` (`.store_id`, `.is_store_principal = True`). New
permission `IsStoreSyncAuthenticated` (`apps/common/permissions.py`) checks that
marker — used by `StoreProvisionPullView` so it can never be reached via staff JWT.
Auth failures return **403**, not 401 — DRF's default when an authentication class
doesn't define `authenticate_header()` (same as the existing `StaffJWTAuthentication`).

Generate/rotate a store's key on the **cloud** deployment:
```bash
docker compose -f docker-compose.prod.yml run --rm backend \
  python manage.py generate_store_sync_key <store_code>
```
Prints `store_code:secret` once — that full string is `CLOUD_SYNC_KEY` in the store's
local `.env`.

### 17.5 New pieces

- `Store.sync_key_hash` (`apps/tenancy/models.py`) — hashed the same way as
  `Staff.pin_code_hash`.
- `apps/sync/models.py::UpstreamSyncState` — singleton (`id=1`) cursor
  (`last_pull_at`, `last_push_at`) living in the *store's* local DB only. The table
  exists in the cloud DB too (same app) but is never populated there.
- `apps/sync/upstream.py` — the store-side HTTP client: `apply_master_data_payload()`,
  `pull_from_cloud()`, `_build_order_push_payload()`, `push_orders_to_cloud()`. Uses
  `requests`.
- `apps/sync/tasks.py::sync_with_cloud_task` — Celery shared task, `autoretry_for=
  (requests.RequestException,)` with backoff. **No-ops with a log line whenever
  `CLOUD_API_URL`/`CLOUD_SYNC_KEY` are blank** — this is what makes it always safe to
  run on the cloud deployment itself and on stores not yet provisioned; nothing about
  normal order-taking/printing/payment ever depends on it.
- `apps/sync/management/commands/sync_now.py` — runs `pull_from_cloud()` +
  `push_orders_to_cloud()` synchronously, for manual testing without waiting for the
  beat schedule.
- `config/celery.py` + `config/__init__.py` — standard Django+Celery bootstrap.
- Settings: `CLOUD_API_URL`, `CLOUD_SYNC_KEY` (both default `""`), `CELERY_BROKER_URL`
  / `CELERY_RESULT_BACKEND` (default `redis://redis:6379/0`), `CELERY_BEAT_SCHEDULE`
  running `sync_with_cloud_task` every `SYNC_INTERVAL_SECONDS` (default 7200 = 2h).
- `docker-compose.yml` gained three services: `redis`, `celery-worker`, `celery-beat`
  (all harmless no-ops when `CLOUD_SYNC_KEY` is unset).

### 17.6 Verified end-to-end

Two independent stacks (separate Postgres, separate Redis/Celery, one acting as
"cloud" on the usual ports, one as a second "store" with overridden ports) were
brought up and exercised directly: `generate_store_sync_key` on the cloud → pasted
into the store's env → `manage.py sync_now` on the store pulled zones/tables/
menu_items/staff/store_settings and applied them locally → PIN login succeeded
against the *store's own* backend (no cloud involved) → an order opened and an item
added purely through the store's local API → a second `sync_now` pushed it → the order
appeared in the cloud's DB with correct recalculated totals (VAT/service charge intact
per rule #12). `celery-worker`/`celery-beat` boot cleanly and register the task; the
task no-ops cleanly on the cloud deployment where `CLOUD_SYNC_KEY` is blank.
