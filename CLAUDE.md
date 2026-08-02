# xPOS — project rules for AI agents

Read `spec-xpost.md` first — it's the ground-truth snapshot of what's actually built. This file is the ruleset for **how to work on it** correctly. Framework-specific rules live in `backend/CLAUDE.md` (Django/DRF) and `frontend/CLAUDE.md` (Next.js) — this file covers infrastructure/deployment and rules that cut across both.

---

## 1. There are two distinct deployments — know which one you're touching

Per `spec-xpost.md` §17, `docker-compose.yml` and `docker-compose.prod.yml` are **not** dev-vs-prod variants of the same thing — they're two different deployment *targets*:

| | `docker-compose.yml` | `docker-compose.prod.yml` |
|---|---|---|
| Role | **Store** — runs on a restaurant's own LAN | **Cloud** — shared, public, multi-store backend |
| Network | LAN-only, plain HTTP, `localhost`/LAN-IP ports | Public HTTPS, real domain |
| Postgres | One store's data only | Shared across all stores |
| Frontend build | Production build (`Dockerfile.prod`) — see §2 below | Production build (`Dockerfile.prod`) |

**Before changing anything Docker/nginx/env-related, be explicit with yourself about which of these two you're changing** — a fix that's correct for one is very often wrong for the other (e.g. forcing HTTPS redirect would break the LAN store deployment; loosening `ALLOWED_HOSTS` to `*` would be a real vulnerability on the cloud deployment).

## 2. `docker-compose.yml`'s frontend service is a production build — this was a real bug fix, not incidental

Both compose files build the frontend from `frontend/Dockerfile.prod` (multi-stage `next build` + standalone `node server.js`). `frontend/Dockerfile` (`npm run dev`, HMR) exists in the repo but **is not used by either compose file**.

**Do not** point `docker-compose.yml`'s `frontend` service back at `Dockerfile` to get hot-reload convenience. This was tried, and it broke customer-facing self-order QR pages in a genuinely hard-to-diagnose way (dev-mode's HMR websocket fails when reached from a phone over LAN+nginx, which somehow prevented the page's own data-fetch `useEffect` from ever completing — no error, just an infinite loading spinner). Full root cause and diagnostic trail is in `spec-xpost.md` §2.1 and §18 if you need to re-verify this before touching it again.

**Consequence for every frontend change:** `docker compose up -d --build frontend` is required — there is no hot-reload. `docker compose up -d` alone (no `--build`) will silently keep serving the old image.

## 3. Secrets and environment variables

- `.env` is gitignored and must **never** be committed. `.env.example` documents the shape without real values — keep it in sync when you add a new required var, but never put a real secret in it.
- `SECRET_KEY` (Django), `POSTGRES_PASSWORD`, and any `sync_key_hash`-derived secret (`generate_store_sync_key` command output, §17.4 of the spec) must only ever live in `.env`/environment, never hardcoded, never logged, never echoed into a commit message or a code comment.
- `NEXT_PUBLIC_*` frontend vars are **not secrets** by definition — they end up in the browser bundle. Never put a real credential behind a `NEXT_PUBLIC_` prefix (see `frontend/CLAUDE.md` §2).
- `StoreSync` credentials (store↔cloud sync, §17.4) are generated once via `generate_store_sync_key` and printed exactly once — if a rotation is needed, generate a new one; there's no "recover the old value" path, and there shouldn't be (that's the point of hashing it server-side the same way staff PINs are hashed).

## 4. Docker/container hygiene

- **Multi-stage builds** (already the pattern in `Dockerfile.prod` for both backend and frontend) — don't collapse them into a single stage; the separation keeps build-time dependencies (compilers, dev packages) out of the final runtime image.
- **Don't run application processes as root in production images** — `frontend/Dockerfile.prod` already creates and switches to a non-root `nextjs` user; follow the same pattern if you add a new production Dockerfile.
- **Named volumes for anything stateful** (`pgdata` for Postgres) — never let a container's writable state live only in the container's own filesystem layer where a `docker compose down` (without `-v`) would still preserve it, but a rebuild-from-scratch wouldn't.
- Before any command that could discard a volume or container state (`docker compose down -v`, `docker system prune`, removing a named volume), treat it exactly like a destructive git operation — confirm with the user first unless explicitly told the data is disposable. `pgdata` in particular holds real order/menu data even in "test" stores.

## 5. Celery/Redis (store↔cloud sync, spec §17.5)

- `sync_with_cloud_task` **no-ops cleanly whenever `CLOUD_API_URL`/`CLOUD_SYNC_KEY` are blank** — this is intentional and load-bearing: it's what makes it safe to run `celery-worker`/`celery-beat` unconditionally on every deployment, including the cloud deployment itself and stores that haven't been provisioned yet. Don't "simplify" this by making the task assume those vars are always set.
- If you add a new Celery task, follow the existing `autoretry_for=(requests.RequestException,)`-with-backoff pattern for anything that makes an HTTP call to another deployment — network calls between store and cloud should never be a single un-retried attempt.

## 6. Keep `spec-xpost.md` in sync

This project's spec doc is treated as authoritative and current, not historical — that only stays true if it's updated alongside the code. **After a change substantial enough that a future agent picking up the repo cold would be misled without it** (new model field, new endpoint, route added/removed/merged, a deployment-behavior change like §2.1, a newly-discovered gotcha), update the relevant section of `spec-xpost.md` in the same batch of work, not as a separate afterthought task. Small/purely-internal refactors with no behavior change don't need a spec update.

## 7. General engineering discipline (applies everywhere in this repo)

- **Don't hard-code a LAN IP, port, or store-specific value** anywhere in source — this project has a documented history of exactly this causing real bugs (a stale `192.168.x.x` baked into a build, a QR link missing a port). Anything environment/deployment-specific belongs in `.env`/`Store` model fields, never a literal in code.
- **Server-derived over client-supplied, whenever both are possible** — this project has removed multiple client-supplied fields (`device_id`, `apiBaseUrl` override, `customer_order_base_url` override) in favor of server/backend-configured equivalents specifically because per-device manual configuration kept drifting and breaking. Default to that direction for any new "where does this value come from" design decision.
- **Run the relevant check before calling a change done**: `python manage.py check` + `python manage.py test` for backend, `npx tsc --noEmit` (and ideally an actual `--build` + manual page check) for frontend. See each framework's `CLAUDE.md` for specifics.
