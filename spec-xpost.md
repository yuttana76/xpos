# xPOS — Restaurant POS System — Current State Specification

> **Purpose of this document:** This is a from-the-ground-truth snapshot of what is *actually implemented* in this repository, written for an AI coding agent picking up development. The original Phase 1 design doc (`xpost-spec.md`) has been removed from the repo — this file is now the **sole** source of truth for current behavior, including deviations, fixes, and additions made after that original doc was written. Keep this file up to date as the codebase changes; it was last brought back in sync with the code on 2026-07-31 (see §18 for the most recent batch of changes).

---

## 1. What this project is

A **restaurant POS system**, SaaS-first, **offline-first** on the client. Staff open tables, take orders, send tickets to the kitchen, take payment, and print receipts — all without internet, syncing to the cloud when connectivity returns. Multi-tenant: many stores share one Django/Postgres backend, strictly isolated by `store_id`.

## 2. Tech stack

- **Backend:** Django + Django REST Framework, PostgreSQL. Custom JWT auth (staff PIN login), not Django's built-in auth/User model.
- **Frontend:** Next.js (App Router) + React, TypeScript, Tailwind CSS. PWA (manifest + service worker for app-shell caching). **Runs as a production build (`Dockerfile.prod`, `next build` + `next start` via standalone output) inside `docker-compose.yml`, not `next dev`** — see §2.1 for why.
- **Local offline storage:** Dexie.js (IndexedDB wrapper) — mirrors master data + orders on-device.
- **Local Print Agent:** standalone Node/Express service (`print-agent/`) — bridges the browser to LAN kitchen/receipt printers, since browsers can't open raw TCP sockets.
- **Containerization:** Docker Compose (`db`, `backend`, `frontend`, `nginx`, `redis`, `celery-worker`, `celery-beat` — see §17).

Repo layout:
```
backend/          Django project (config/ + apps/)
frontend/         Next.js app (src/app/, src/lib/, src/components/)
print-agent/      Standalone Node print bridge (NOT in docker-compose; run separately)
nginx/            Reverse proxy config (dev.conf for docker-compose.yml, templates/ for prod)
docker-compose.yml / docker-compose.prod.yml
spec-xpost.md              This file (current-state reference — the only spec doc in the repo)
```

### 2.1 Frontend runs as a production build, even in `docker-compose.yml`

`frontend/Dockerfile` (`npm run dev`, hot-reload) is **no longer used by `docker-compose.yml`**. The `frontend` service there now builds from `frontend/Dockerfile.prod` (multi-stage: `npm run build` → Next.js standalone output → `node server.js`), the same Dockerfile `docker-compose.prod.yml` was already using for the cloud deployment.

**Why:** `docker-compose.yml` is the *store* LAN deployment (§17) — customers' own phones load `/order-session/[token]` over the store's WiFi through nginx, on a different origin (`http://<LAN-IP>:8080`) than `localhost`. Next.js dev mode's webpack-HMR client tries to hold a WebSocket open back to the dev server (`/_next/webpack-hmr`); when reached from a phone over a LAN IP through the nginx proxy that connection fails and retries in a tight loop, which was observed to prevent the page's own `useEffect`-driven data fetch from ever completing (page stuck on a loading spinner indefinitely, no error, nothing in the Network tab) even though the exact same API call worked fine when issued manually from the browser console. Switching to a production build removes HMR entirely and fixed it outright.

**Consequence:** editing any frontend file now requires `docker compose up -d --build frontend` to see the change — there is no hot-reload in this deployment mode anymore. `NEXT_PUBLIC_API_BASE_URL` is passed as a Docker build **arg** (baked into the client JS bundle at build time, per Next.js's `NEXT_PUBLIC_*` convention), not a runtime env var — changing it also requires a rebuild, not just a container restart.

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
name, device_id (default "POS01"), tax_id (nullable), address (nullable),
customer_order_base_url (nullable URLField),
vat_rate (default 7.00), service_charge_rate (default 0.00),
sync_key_hash (nullable — see §17.4), is_active, updated_at
```
**Delta from original spec:** added `store_code` (see §6), `address` (added for Thai receipt compliance, §12), `sync_key_hash` (§17.4).

**Recent additions (2026-07-31), both configured via Django admin only, no frontend UI to set them:**
- **`device_id`** (`CharField`, default `"POS01"`) — the POS receipt-number prefix, moved here from a per-device `localStorage` setting (see §6). **Assumes exactly one POS device per store** — the help text on the field says so explicitly. If a store ever runs two physical POS terminals simultaneously, this field as designed will make both terminals issue receipt numbers with the *same* prefix, defeating the whole point of rule #3 (per-device receipt prefixing to avoid collisions). Revisit before allowing multi-device stores.
- **`customer_order_base_url`** (`URLField`, nullable) — the base URL a customer's phone should hit when scanning a self-order QR code (e.g. `http://192.168.9.13:8080`), moved here from a per-device `localStorage` setting for the same reason `device_id` was (a store-level fact, not a device-level one). If blank, QR generation falls back to `window.location.origin` (the staff device's own current URL) — see §11.

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

- **Login is PIN + `store_code`**, not username/password. `POST /api/auth/pin-login/` body: `{store_code, pin}` — **no `device_id` in the request** (see below, changed 2026-07-31).
  - Looks up `Store` by `store_code`, then scans that store's active `Staff` checking `pin_code_hash` via `django.contrib.auth.hashers.check_password`.
  - Returns `{token, staff: {id, name, role}, store: {id, name, device_id, vat_rate, service_charge_rate, tax_id, address, customer_order_base_url}}`.
- JWT payload: `{staff_id, store_id, device_id, role, iat, exp}` (12h TTL). `store_id` here is the UUID — **this is the only store_id the rest of the API ever trusts**, regardless of what `store_code` was used to log in. `device_id` is **derived server-side from `Store.device_id`** (§4), never trusted from the client — `PinLoginView` used to accept a client-supplied `device_id` in the request body and pass it straight into the JWT unvalidated; that was removed as part of moving `device_id` to a Store-level backend field (single-POS-device-per-store).
- `apps/common/authentication.py::StaffJWTAuthentication` decodes the token, re-fetches the live `Staff` row (`is_active=True`, matching `store_id`) on every request — a deactivated staff member is locked out immediately, no waiting for token expiry.
- **`PinLoginView` is rate-limited** (added 2026-07-31): `apps.staff.views.PinLoginRateThrottle` (DRF `AnonRateThrottle`, scope `pin_login`, `10/min` per IP — see `REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`). Backed by a Redis `CACHES["default"]` (DB 1, separate from Celery's DB 0 — `DJANGO_CACHE_URL`, default `redis://redis:6379/1`), not Django's default per-process cache, so the limit holds across multiple backend worker processes. PINs are low-entropy (4 digits in `seed_demo`) and this endpoint has no authentication at all, so it was a real brute-force gap before this.
- Permissions (`apps/common/permissions.py`):
  - `IsOwnerOrManager` — role in (OWNER, MANAGER)
  - `IsOwner` — role == OWNER only
  - Most endpoints have no explicit `permission_classes` (any authenticated staff), a few are `AllowAny` (pin-login itself, public self-order endpoints).

---

## 6. Store identification: `store_code` vs `store_id`

Originally devices were configured with the Store's raw UUID (`storeId` in `DeviceConfig`). This was replaced with a short, human-typeable `store_code` (e.g. `XPOS01`) because staff were mistyping/pasting the wrong values.

### 6.1 `/setup` no longer exists — merged into `/login` (2026-07-31)

There used to be a separate `/setup` route collecting `apiBaseUrl`, `storeCode`, `deviceId`. All three of those were removed from client-side config one at a time and the route was deleted entirely once nothing was left for it to configure:

- **`apiBaseUrl`** — removed first. `frontend/src/lib/api.ts` now reads **only** `process.env.NEXT_PUBLIC_API_BASE_URL` (build-time env var, falls back to `http://localhost:8010` if unset) — never a per-device override. See §2.1 for why this is a *build* arg, not a runtime setting.
- **`deviceId`** — moved to `Store.device_id` on the backend (§4), fetched from the pin-login response instead of typed in locally.
- **`storeCode`** — the only field left. It's now entered directly on `/login` instead of a separate page: `frontend/src/app/login/page.tsx` shows a store-code form first if none is saved yet (`getDeviceConfig()?.storeCode` is falsy), otherwise it goes straight to the PIN pad. There's a "เปลี่ยนร้าน" button on the PIN pad that flips a local `editingStore` state back to the store-code form **in place** — no route navigation, no `/setup` page exists to navigate to. `DeviceConfig` (`frontend/src/lib/session.ts`) is now just `{ storeCode: string }`.
- The old *old*-schema-detection redirect (`!device.storeCode` → bounce to `/setup`) is gone along with the route; `/login` handles "no store configured yet" as its own first-render state instead of redirecting anywhere.
- Root `page.tsx` redirect logic simplified accordingly: `getStaffSession() ? "/floor" : "/login"` (previously a three-way check involving `getDeviceConfig()` too).

### 6.2 Store-name lookup before login

New public endpoint, `GET /api/public/store/<store_code>/` (`apps/tenancy/views.py::StoreLookupView`, `AllowAny`) — returns `{name, store_code}` only (no `tax_id`/`address`/`device_id`/etc., since this is reachable pre-login by anyone who can reach the API and guess/know a `store_code`). `/login` calls this with a 400ms debounce as the staff types the store code, showing "ร้าน: {name}" so a mistyped store code is caught before it's saved — and shows the resolved name again above the PIN pad, so staff can visually confirm which store they're about to log into.

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

### Public store lookup — `apps.tenancy` (`/api/public/store/`) — **new 2026-07-31**
- `GET <store_code>/` — `AllowAny`, returns `{name, store_code}` only. Used by `/login` to show the store name before/while entering a PIN (§6.2). 404 if the store doesn't exist or `is_active=False`.

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

### 8.8 `OrderItemAdmin` search + table column (2026-07-31)
`apps/orders/admin.py::OrderItemAdmin` gained `search_fields = ("order__receipt_number",)` (previously had none at all — no way to find an item by receipt number in `/admin/orders/orderitem/`) and a computed `order_table` column (`obj.order.table`, sortable via `ordering="order__table__name"`) plus `list_select_related = ("order", "order__table")` to avoid N+1 queries on the list view.

---

## 9. Frontend structure

### Routes (`frontend/src/app/`)
```
/                          → public one-page landing (Home/Service/Contact sections, anchor-
                             scroll nav, "เข้าสู่ระบบ" → /login) — added 2026-07-31, see below.
                             Logged-in staff (valid session) get redirected to /floor via a
                             background effect; content renders immediately either way (not
                             gated behind the check) since this is a public, crawlable page.
/login                     → store-code entry (first run) + PIN pad, one page, no /setup route
                             anymore — see §6.1. "เปลี่ยนร้าน" toggles back to the store-code
                             form in place (no navigation).
/floor                     → table grid + kitchen-status panel (split into "โต๊ะ"/"Takeaway"
                             sections, Takeaway cards show customer_name/customer_phone when
                             present — added 2026-07-31) + revenue summary tiles (role-aware)
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
`localStorage` keys `xpos.device` (`DeviceConfig`: **just `{storeCode}`** as of 2026-07-31 — `apiBaseUrl` and `deviceId` were removed, see §6.1/§4) and `xpos.session` (`StaffSession`: `token, staff {id,name,role}, store {id, name, device_id, vat_rate, service_charge_rate, tax_id, address, customer_order_base_url}`). No cookies, no server sessions — everything is the JWT in `xpos.session` sent as `Authorization: Bearer`.

Also exports `normalizeCustomerOrderBaseUrl(raw: string): string | null` — trims, auto-prepends `http://` if the scheme is missing, validates via `new URL()`, returns `null` for blank/invalid input. Used both when building the self-order QR link (`orders/[orderId]/page.tsx`, reads `session.store.customer_order_base_url`) and as a defensive normalizer in case a Store's `customer_order_base_url` was saved via admin without a scheme.

### `frontend/src/lib/api.ts`
Thin fetch wrapper: `api.get/post/patch/del`. Throws `ApiError` (with `.status`) on non-2xx. Base URL comes **only** from `process.env.NEXT_PUBLIC_API_BASE_URL` (see §2.1/§6.1 — no more per-device override).

### Dexie schema (`frontend/src/lib/db.ts`)
Mirrors master data + orders. See file for the full table list — unchanged in shape from original spec's intent, just confirmed accurate as of this writing (§4 above lists the source-of-truth Django models; Dexie interfaces mirror them field-for-field).

### `frontend/src/components/Sidebar.tsx`
Persistent left nav (desktop: static column; mobile: hamburger + slide-over drawer with backdrop). Role-filtered nav items. Contains an **expandable "รายงาน" sub-menu** (auto-expands if the current route is a report sub-page), grouped by category (ยอดขาย / ตรวจสอบ / ภาษี) matching the `/reports` hub categorization. Hidden entirely on `/`, `/login`, `/order-session/*`.

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

- **Order item list:** grouped by menu category (same category order as the "Add item" picker below), with items whose category can't be resolved (e.g. category was deleted) bucketed under "อื่นๆ" at the end — added 2026-07-31, previously a flat list. Checkbox-select/edit/void/serve behavior per item is unchanged.
- **Add item modal:** quantity stepper + per-`ModifierGroup` **single-select (radio)** options (not checkboxes — a deliberate correction from an earlier multi-select version), required groups block confirmation until satisfied. Shows a **live-updating unit-price × qty = total** preview as you adjust quantity/modifiers.
- **Edit item:** re-opens the same modal pre-filled. If quantity/modifiers are unchanged but `kitchen_status` is changed via the dropdown, it's applied **in place** (`.../kitchen-status/` endpoint, no re-creation). If content *did* change, the old item is voided and a new one created (existing immutable-line-item architecture) — the new item always starts at PENDING regardless of what the status dropdown said, since changed content genuinely needs re-cooking.
- **Send to kitchen:** single button, always enabled once the order has any item. Prints **all current items grouped by menu category** (not just newly-added ones) to that category's assigned `KitchenPrinter` (or "N/A" if unset), then marks any still-PENDING items SENT. If nothing is PENDING when pressed, it **reprints** everything already sent instead (ticket header gets a "(พิมพ์ซ้ำ)" suffix) — one button covers both send and reprint, no separate reprint UI.
- **"แสดง QR ให้ลูกค้าสั่งเอง" button** (dine-in orders only, requires a `session_token`): opens a modal with a `QRCodeSVG` encoding `{customer_order_base_url or window.location.origin}/order-session/{session_token}` (§6.2/§4 for where that base URL comes from), a copyable raw link, a "พิมพ์ (เบราว์เซอร์)" button, and a print-to-kitchen-printer option. Copy/share both target the same computed URL.
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
- No automated test coverage was added for the new `/api/orders/reports/*` endpoints or the `/api/floor/`, `/api/menu/` CRUD endpoints (only manually verified via curl + Playwright browser sessions during development). The Django test suite (17 tests across `apps/orders/tests.py` and `apps/sync/tests.py` — see §16) still passes but does not cover this new surface area.
- `print-agent` has no auto-restart/watch mode — see §9 warning.
- **`Store.device_id` and `Store.customer_order_base_url` (§4) both assume exactly one POS device per store.** If a store ever needs two+ simultaneous terminals, `device_id` as currently designed will make both terminals share the same receipt-number prefix (collision risk, defeats rule #3) — this needs a real per-device identity scheme again (e.g. a device-registration flow) before that's safe, not just reverting the `/setup` field.
- No new automated tests were added for `StoreLookupView` (§6.2), the `PinLoginView` `device_id`-derivation change, or the `PinLoginRateThrottle` addition (§5) — only manually curl-verified during development (throttle behavior specifically: hammered the endpoint past the limit, confirmed 429 + `Retry-After`, confirmed the throttle key actually lands in Redis DB 1, confirmed a legit login succeeds again once the window is cleared).

---

## 16. If you're picking this up cold

1. `docker compose up -d --build` brings up db/backend/frontend/nginx/redis/celery-worker/celery-beat. **The `--build` matters** — the frontend is a production build now (§2.1), so plain `up -d` after a code change will silently keep serving the stale image. `print-agent/` is separate: `cd print-agent && node server.js` (optionally `ENABLE_REAL_PRINTING=true`).
2. Seed data: `python manage.py seed_demo` (inside the backend container) creates a demo store with `store_code=XPOS01`, `device_id=POS01` (model default, §4), an owner (PIN `1111`) and server (PIN `2222`).
3. First run on a fresh browser: go straight to `/login` (no `/setup` anymore, §6.1) — enter the store code once, then the PIN pad. `device_id` and the self-order QR base URL are **not** entered anywhere in the UI — set `Store.device_id` / `Store.customer_order_base_url` via Django admin if the defaults (`POS01`, blank) aren't right for the deployment.
4. To test as an Owner with multiple stores, create a second `Store` + `Staff`, then add it to the first owner's `additional_stores` via Django admin.
5. Backend tests: `python manage.py test` (fast, ~4s, 17 tests across `apps/orders/tests.py` and `apps/sync/tests.py`).
6. When adding any new synced master-data model or endpoint: inherit `SoftDeleteModelViewSet`, scope via JWT `store_id` (never trust client-supplied store IDs), and if you ever bulk-`.update()` rows that matter to sync, remember to bump `updated_at` explicitly (§8.4).
7. Frontend type-check before rebuilding: `cd frontend && npx tsc --noEmit` (fast; the Docker build itself also runs a full `next build`, which is a stricter/slower check — a clean `tsc` doesn't guarantee a clean `next build`, e.g. it won't catch stale generated `.next/dev/types` if you deleted a route — delete `frontend/.next` locally if `tsc` complains about a route file that no longer exists).

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

---

## 18. Changelog — 2026-07-31 batch

Everything below was implemented and verified in one working session; **as of this writing it is uncommitted on `main`** (`git status` shows it all as unstaged/untracked — commit when ready, this doc doesn't do that for you). Listed here as a single reference point since it touches several sections above.

1. **Fixed a real QR self-order bug** (§2.1): `docker-compose.yml`'s `frontend` service switched from `Dockerfile` (dev/HMR) to `Dockerfile.prod` (production build) — root-caused a customer's phone getting stuck on "กำลังโหลดเมนู..." forever with no console error, traced to the dev-mode HMR websocket failing over a LAN-IP+nginx origin and apparently blocking the page's own data fetch from ever completing.
2. **`Store.customer_order_base_url`** added (§4) — self-order QR base URL moved from a per-device `localStorage` setting to a Store-level backend field, admin-configured.
3. **`Store.device_id`** added (§4, §5) — receipt-number device prefix moved the same way; `PinLoginView` no longer trusts a client-supplied `device_id`, derives it from `Store.device_id` server-side instead. **Known limitation:** single-device-per-store only (§15).
4. **`/setup` route deleted, merged into `/login`** (§6.1) — the only thing left to configure client-side is `storeCode`; `apiBaseUrl` is now env-only (§2.1), `deviceId` is backend-only (§4).
5. **New public endpoint** `GET /api/public/store/<store_code>/` (§6.2, §7) — store-name lookup, used by `/login` to show which store you're about to log into.
6. **`OrderItemAdmin`** (§8.8) gained `search_fields` (by receipt number) and a `order_table` column — previously had neither.
7. **Order item list on `/orders/[orderId]`** (§11) now grouped by menu category, matching the "Add item" picker's grouping — was a flat list before.
8. **`/floor` kitchen-status panel** now split into "โต๊ะ" and "Takeaway" sections; Takeaway cards show `customer_name`/`customer_phone` when present — previously one mixed grid with no customer info shown at all.
9. **Added `CLAUDE.md` rule files** (root, `backend/`, `frontend/`) codifying framework-specific do's/don'ts for AI agents working on this repo, grounded in the official Next.js and Django docs plus every gotcha already documented in this spec.
10. **`PinLoginView` rate-limited** (§5) — found and fixed during a framework-best-practices audit prompted by writing the `CLAUDE.md` files above: the PIN-login endpoint had zero brute-force protection despite 4-digit PINs and `AllowAny`. Added a Redis-backed DRF throttle (`10/min` per IP) — first real infrastructure dependency the Django app has on Redis beyond Celery (new `CACHES` setting, DB 1).
11. **`/` replaced with a real public landing page** (§9) — previously an invisible client-side redirect (`/login` or `/floor` depending on session), now a one-page site (Home/Service/Contact sections, sticky nav with anchor-scroll links, "เข้าสู่ระบบ" → `/login`). Content renders in the server-rendered HTML unconditionally (verified via `curl` — a first pass gated the whole page behind a client-only session check, which meant `curl`/no-JS/search-engine visitors saw only a loading spinner; fixed to render immediately and redirect already-logged-in staff to `/floor` in the background instead). `StatusBar` (`frontend/src/components/StatusBar.tsx`) — previously rendered unconditionally on every route — now hides on `/`, `/login`, and `/order-session/*` the same way `Sidebar` already did, since the online/sync status bar is staff-only chrome that has no place on a public page. `<html>` gained Tailwind's `scroll-smooth` class (`layout.tsx`) for the anchor-scroll nav; each section has `scroll-mt-*` so the sticky header doesn't cover the scrolled-to content. Contact section uses **placeholder** email/phone/address — swap for real details before this goes live.
