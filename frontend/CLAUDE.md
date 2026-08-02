# Frontend rules (Next.js App Router) — `frontend/`

This file governs AI agent work inside `frontend/`. Read `../spec-xpost.md` first (§9, §11, §2.1) for what's actually built. If anything here conflicts with the spec, the spec wins — it reflects the real, shipped, verified state.

Sources: [Next.js project structure](https://nextjs.org/docs/app/getting-started/project-structure), [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), [Environment variables](https://nextjs.org/docs/app/guides/environment-variables), and this project's own `spec-xpost.md`.

---

## 1. This app is almost entirely Client Components — that's deliberate, not a mistake

Next.js's official default guidance is: **prefer Server Components, add `"use client"` only where interactivity/browser APIs are genuinely needed**, to minimize client JS and keep secrets off the client. This project's pages are almost all `"use client"` from the top. **Do not "fix" this by converting pages to Server Components** — it would break the app's actual architecture:

- The whole app is **offline-first**: every page reads/writes Dexie (IndexedDB) and `localStorage` (`xpos.device`, `xpos.session`) directly, both browser-only APIs unavailable in a Server Component.
- Auth is a client-held JWT in `localStorage`, not a cookie/server session — there's no server-side request context to attach a Server Component data-fetch to in the way Next.js's official pattern assumes.
- The self-order QR flow (`/order-session/[token]`) and the whole staff app need to keep working with zero network connectivity — that's incompatible with Server-Component data fetching, which requires the server to be reachable per navigation.

If you're adding a genuinely static, non-interactive piece of UI (e.g. a marketing-style page with no Dexie/session dependency), a Server Component is fine and preferred there — just don't assume it's fine by default the way you would on a typical Next.js app. Check whether the page touches `session.ts`/`db.ts` first.

## 2. Environment variables — build-time only, no runtime overrides

Per Next.js's own docs: `NEXT_PUBLIC_*` variables are **inlined into the client JS bundle at `next build` time** — "after being built, your app will no longer respond to changes to these environment variables" (direct from the Next.js docs). This project's own history proves this the hard way (see `spec-xpost.md` §2.1) — a stale `NEXT_PUBLIC_API_BASE_URL` baked into an old build caused a customer's QR self-order page to silently fail against an unreachable IP, and the fix required a full rebuild, not a container restart.

Rules:
- **`frontend/src/lib/api.ts` reads `process.env.NEXT_PUBLIC_API_BASE_URL` and nothing else** for the API base URL. Don't reintroduce a per-device `localStorage` override for this — it was deliberately removed (spec §6.1) precisely because it created a second, easy-to-desync source of truth.
- **Never** put a secret (API key, credential) behind `NEXT_PUBLIC_` — it ends up in the browser bundle, readable by anyone. This project has no such secrets on the frontend currently; keep it that way.
- After changing anything `NEXT_PUBLIC_*`-related or any frontend source file: **`docker compose up -d --build frontend` is required, not optional** — see §3 below, this project's `docker-compose.yml` runs a production build with no hot-reload.
- Dynamic lookups like `process.env[someVariable]` do **not** get inlined by Next.js's static analysis — don't write env-var access that way if it needs to reach the client bundle.

## 3. The frontend runs as a Next.js production build in `docker-compose.yml` — no HMR

`docker-compose.yml`'s `frontend` service builds from `Dockerfile.prod` (`next build` → standalone output → `node server.js`), **not** `Dockerfile` (`next dev`). This was a deliberate fix (spec §2.1): dev-mode's webpack-HMR client tries to hold a WebSocket back to the dev server, which reliably breaks when the app is reached from a phone over a LAN IP through the nginx proxy (a real customer-facing bug: page stuck on a loading spinner forever, zero console errors, nothing in the Network tab, even though the exact same API call worked fine issued manually).

- **There is no hot-reload in this deployment mode.** Any frontend code change requires `docker compose up -d --build frontend` to actually take effect. Don't debug a "why isn't my change showing up" mystery without checking this first.
- If you genuinely need dev-mode HMR for fast local iteration (not testing against a real phone/LAN device), that's what `npm run dev` directly (outside Docker) or a manual `docker build -f frontend/Dockerfile ...` is for — don't silently switch `docker-compose.yml` back to dev mode to make your own iteration faster; that reintroduces the exact bug that was fixed.

## 4. Next.js App Router conventions — follow the framework's own file rules

- **Routing files** (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`) only go where you intend a route/behavior — a stray `page.tsx` in a folder makes it publicly routable. This project has no `route.ts` API handlers (`app/api/`) — API calls all go to the Django backend via `lib/api.ts`, keep it that way; don't add a Next.js Route Handler as a proxy layer without a specific reason.
- **Colocation is safe and encouraged** — non-`page`/`layout`/`route`-named files inside `app/` are never routable. Use a leading underscore (`_components/`, `_lib/`) for anything you want visually/structurally marked as "not a route, don't treat as one" — the project doesn't consistently do this yet (most shared code lives in `src/lib/`, `src/components/` outside `app/`), but it's a reasonable pattern to adopt for route-specific helpers.
- **Dynamic route params are async** (`params: Promise<{ token: string }>`, unwrapped via React's `use()`) — this project already does this correctly (`order-session/[token]/page.tsx`, `orders/[orderId]/page.tsx`). Don't regress to treating `params` as a plain synchronous object.
- **`"use client"` goes at the very top of the file, above imports.** Once a file has it, everything it imports and directly renders is pulled into the client bundle — don't add it defensively to a file that doesn't need it; check whether the parent already establishes the client boundary.

## 5. Project-specific state conventions — don't reinvent these

- **`frontend/src/lib/session.ts`** is the single source of truth for device/session state (`DeviceConfig`: just `{storeCode}`; `StaffSession`: token + staff + full `StoreSettings` including `device_id`, `customer_order_base_url`, tax/VAT fields). Read/write through its exported functions (`getDeviceConfig`, `setStaffSession`, etc.) — don't touch `localStorage` directly elsewhere.
- **Store-level settings that used to be per-device `localStorage` config** (`device_id`, `customer_order_base_url` — see spec §4/§6) now come from the backend via `StaffSession.store`, fetched at login. Don't reintroduce a frontend-editable field for either — if a new store-level setting is needed, add it to the Django `Store` model + admin, then surface it through the pin-login response, following that exact pattern.
- **`normalizeCustomerOrderBaseUrl()`** (`session.ts`) is the canonical way to turn a possibly-scheme-less, possibly-blank URL string into a safe absolute URL or `null`. Reuse it for any similar "backend-configured URL that a human might paste without `http://`" situation — don't write a second ad-hoc URL normalizer.
- **Dexie (`frontend/src/lib/db.ts`)** mirrors backend master data + orders for offline use. Any new synced model on the backend needs a matching Dexie table + sync-pull handling — a backend-only model addition is incomplete for this app's offline-first contract.
- **`api.ts`'s `ApiError`** (with `.status`) is how HTTP errors surface — check `err instanceof ApiError && err.status === 404` (etc.) rather than parsing error messages. The "missing order" UX pattern (`orders/[orderId]/page.tsx`) is the reference implementation for handling a resource that legitimately vanished server-side.

## 6. Before calling frontend work done

- `cd frontend && npx tsc --noEmit` — fast type-check. **Note:** a stale local `.next/dev/types/` cache can report a phantom error for a route you just deleted; `rm -rf frontend/.next` if `tsc` complains about a file that doesn't exist anymore.
- A clean `tsc --noEmit` does **not** guarantee a clean `next build`, which is what the Docker image actually runs and is a stricter/slower check — if the change is nontrivial, prefer to actually run the `docker compose up -d --build frontend` and hit the page rather than trusting `tsc` alone.
- No test suite currently exists on the frontend (Playwright sessions were used manually during development per spec §15) — there's nothing to run automatically; manual verification in a real browser is the only check available right now for UI-level correctness.
