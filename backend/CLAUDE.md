# Backend rules (Django + DRF) — `backend/`

This file governs AI agent work inside `backend/`. Read `../spec-xpost.md` first for what's actually built — this file is about **how to build/change it correctly**, not what exists. If anything here conflicts with `spec-xpost.md`, the spec wins (it reflects the real, shipped state); update this file to match, don't silently ignore the conflict.

Sources: [Django design philosophies](https://docs.djangoproject.com/en/stable/misc/design-philosophies/), [Django security](https://docs.djangoproject.com/en/stable/topics/security/), and this project's own `spec-xpost.md` §3/§8 (rules learned the hard way during development — treat those as equally authoritative as anything below).

---

## 1. Non-negotiable project rules (spec-xpost.md §3 — do not relitigate these)

These are load-bearing for the offline-first, multi-tenant architecture. Violating them breaks things in ways that are hard to detect in dev and show up as data corruption in production:

1. **UUIDv4 PKs everywhere.** Never add an auto-increment PK to a synced model — offline devices generate IDs client-side and collisions must be structurally impossible.
2. **`store_id` is server-derived only, always.** Every view must scope queries via `request.user.store_id` (from the JWT). **Never** trust a `store_id` from `request.data`/query params — that's an IDOR waiting to happen in a multi-tenant system. The one sanctioned exception is `store_code` at login time (a lookup key, not a trust boundary).
3. **Soft-delete only on synced master data** (`Zone`, `Table`, `Category`, `MenuItem`, `ModifierGroup`, `ModifierOption`, `KitchenPrinter`). Inherit `apps.common.viewsets.SoftDeleteModelViewSet` for any new synced-master-data ViewSet — it structurally omits `DestroyModelMixin`. **Never hard-delete a row a client may have cached** — the incremental pull sync (`updated_at__gt=since`) has no tombstone mechanism; a hard-deleted row just silently vanishes from future pulls while stale clients keep it forever. If you must clean up via shell/admin, that's a client-IndexedDB-clearing problem, not a backend one — don't paper over it with a backend fix that doesn't exist.
4. **Money calculation order is fixed:** Discount → Service Charge → VAT (`apps/orders/services.py::recalculate_order_totals`). Never reorder. The frontend's offline estimate (`calc.ts`) must be kept in lockstep if you touch this.
5. **Every order-total recalculation runs inside `transaction.atomic()` with `select_for_update()`** on the `Order` row. Don't add a new totals-mutating code path that skips this.

## 2. Django framework fundamentals — apply these by default

Per Django's own design philosophy (loose coupling, DRY, explicit > implicit, fat models / thin views):

- **Business logic belongs in `models.py` or a dedicated `services.py`, not in views.** This project already follows this (`apps/orders/services.py::recalculate_order_totals`) — extend that pattern, don't put calculation/validation logic inline in a DRF view.
- **Use the ORM's parameterized queries; never string-format user input into SQL.** If you ever reach for `.extra()` or `RawSQL`, that's a signal to stop and use the ORM properly instead, or at minimum escape parameters explicitly.
- **Let Django templates/DRF serializers handle escaping — don't bypass it.** No `mark_safe()` on anything derived from user input. This is a DRF-only backend (no server-rendered HTML templates in this project), but the same instinct applies to anything that ends up rendered client-side without sanitization.
- **Migrations are one-way documentation of schema history — never edit an already-applied migration.** Create a new migration instead, even to fix a mistake in the last one, unless it's still unapplied anywhere.
- **`DEBUG` and `SECRET_KEY` are environment-driven, never hardcoded** (`.env`, gitignored). Never commit a real `SECRET_KEY` or set `DEBUG = True` in anything that isn't unambiguously local dev config.

## 3. Django security checklist — DO

Straight from Django's own security docs — apply these without being asked, especially before anything resembling a "prod" or "cloud" change (`docker-compose.prod.yml` path):

- `ALLOWED_HOSTS` must be **explicitly set** per environment — never rely on web-server config alone. Access the `Host` header via `request.get_host()`, never `request.META['HTTP_HOST']` directly (bypasses Django's own validation).
- CSRF middleware (`CsrfViewMiddleware`) must stay enabled. Only reach for `@csrf_exempt` when there's a documented reason (e.g. a genuinely public, token-authenticated API endpoint like this project's `apps.orders.public_urls`) — never as a quick fix for a CSRF error you don't understand yet.
- In any production-facing settings path: `SECURE_SSL_REDIRECT = True`, `SESSION_COOKIE_SECURE = True`, `CSRF_COOKIE_SECURE = True`, and HSTS settings (`SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS`). `docker-compose.yml` (the LAN store deployment) deliberately runs plain HTTP by design (§17 of the spec) — don't "fix" that by forcing HTTPS there; it would break the whole LAN deployment model. Cloud (`docker-compose.prod.yml`) is where these apply.
- Any new `Authorization`-style header scheme (this project already has two: `Bearer` JWT for staff, `StoreSync <code>:<secret>` for store↔cloud sync) should return **403, not 401**, matching this codebase's existing convention (`authenticate_header()` intentionally left undefined) — check `apps/common/authentication.py` before adding a third scheme.
- Rate limiting / brute-force protection is **not** built into Django by default. This project implements it manually for `PinLoginView` via a scoped DRF `AnonRateThrottle` (`apps.staff.views.PinLoginRateThrottle`, scope `pin_login`, `10/min` per IP, configured in `REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`) — backed by a **Redis-backed `CACHES["default"]`** (DB 1, separate from Celery's DB 0), not Django's default per-process `locmem` cache, because throttle counters must be shared across worker processes to actually enforce the configured rate. If you add another unauthenticated, low-entropy-credential endpoint (anything PIN/OTP-like), give it the same treatment — don't assume DRF's defaults protect it.

## 4. Django security checklist — DON'T

- **Never** commit `SECRET_KEY`, `sync_key_hash` secrets, or any `.env` file contents to git.
- **Never** leave `DEBUG = True` reachable in anything other than explicit local dev.
- **Never** concatenate user input into a raw SQL string, even "just this once."
- **Never** compare `store_id` values with bare Python `==`/`!=` outside a queryset without `str()`-ing both sides first — `some_fk.store_id` from a loaded instance is a `uuid.UUID`, `request.user.store_id` from the JWT is a `str`; comparing them is **always `True`/unequal** even when they're the same store. This bit the project for real during floor/menu CRUD development (§8.5 of the spec). `.filter(store_id=x)` via the ORM is safe either way — it's only manual comparisons that are at risk.
- **Never** trust a client-supplied identity field (`store_id`, `device_id`, etc.) when a server-derived equivalent exists. `PinLoginView` used to accept a client-supplied `device_id` and pass it straight into the JWT unvalidated — that was a real bug, fixed by deriving it from `Store.device_id` server-side instead (spec §5). Treat any future "client sends X, server just uses it" pattern with the same suspicion.

## 5. Project-specific gotchas (learned the hard way — spec-xpost.md §8)

Don't rediscover these by breaking something:

- **Bulk `.update()` does not trigger `auto_now`.** `Model.objects.filter(...).update(status=X)` skips Django's `auto_now` logic on `updated_at`, unlike `.save()`. Any bulk `.update()` on a model whose `updated_at` matters to incremental sync **must** explicitly pass `updated_at=timezone.now()` in the `.update()` kwargs. This broke cross-device sync twice during development.
- **`NULL` sorts first in Postgres `ORDER BY ... DESC`.** When aggregating with `filter=Q(...)` on `Sum`/`Count` for "show every row even with zero activity" reports, unmatched rows produce SQL `NULL`, not `0` — and Postgres puts `NULL` *before* all values in `DESC` order, so a zero-activity row jumps to the top instead of the bottom. Wrap the aggregate in `Coalesce(Sum(...), Value(Decimal("0.00")), output_field=DecimalField(...))` before sorting by it.
- **`_accessible_stores(request)`** (`apps/orders/views.py`) is the single source of truth for which stores an OWNER can see across multi-store reporting — import it, never re-derive this logic inline in a new report view.
- **Menu-item `version` field** is bumped on every `MenuItemViewSet` update for future client-side cache-busting — not read by any frontend code yet, but keep bumping it on every update; don't remove it because it looks unused.

## 6. DRF conventions already in use — follow them

- **Permissions:** `IsOwnerOrManager`, `IsOwner` (`apps/common/permissions.py`). Most endpoints have no explicit `permission_classes` (any authenticated staff) — only restrict further when the feature genuinely needs it (matches Django's "explicit is better than implicit," but don't over-restrict either; check what similar existing endpoints do before picking a permission class).
- **Public (`AllowAny`) endpoints** are the exception, not the norm — currently only `pin-login`, the two `apps.orders.public_urls` self-order endpoints, and `apps.tenancy`'s store-name lookup. Justify any new one in a comment the way the existing ones are.
- **New synced master-data model or endpoint checklist:** inherit `SoftDeleteModelViewSet`, scope every queryset via JWT `store_id`, and if you bulk-`.update()` anything sync-relevant, bump `updated_at` explicitly (see §5 above).

## 7. Testing — before calling backend work done

- Run `python manage.py check` (fast sanity check for model/URL/admin misconfiguration) and `python manage.py test` (currently 17 tests across `apps/orders/tests.py` and `apps/sync/tests.py`) after any backend change, even a "small" one — both are cheap (~5s total).
- New endpoints/reports added without test coverage should at minimum be curl-verified manually and that verification method noted if a real test isn't added (this project already has real gaps here per spec §15 — don't make the gap bigger without at least flagging it).
- After adding/changing a model field: `python manage.py makemigrations <app>` then `python manage.py migrate` — check the generated migration file before applying it, especially for non-nullable fields on a table with existing rows (needs a sensible default, not an interactive prompt left unanswered).
