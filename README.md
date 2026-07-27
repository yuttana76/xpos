# xPOS — Restaurant POS System (Phase 1 MVP)

Offline-first, multi-tenant POS สำหรับร้านอาหาร ดูสเป็คฉบับเต็มที่ [xpost-spec.md](xpost-spec.md)

## Prerequisites

- Docker + Docker Compose
- Node.js 20+ และ npm (สำหรับ frontend และ print-agent)

## Quick Start

```bash
./scripts/init.sh
```

Script นี้จะจัดการให้ทั้งหมด: สร้าง `.env`, build/start Postgres + backend ผ่าน Docker, รัน migration, seed ข้อมูลตัวอย่าง, และติดตั้ง npm dependencies ของ frontend/print-agent ให้อัตโนมัติ

โหมดอื่นๆ:

```bash
./scripts/init.sh --reset      # ล้างข้อมูลเดิมทั้งหมด (ลบ Postgres volume) แล้วเริ่มใหม่
./scripts/init.sh --seed-only  # รัน seed_demo ใหม่เฉยๆ ไม่แตะ Docker/migration
```

> **หมายเหตุ:** `--reset` จะสุ่ม Store ID ใหม่ทุกครั้ง ถ้าเคยตั้งค่าอุปกรณ์ในหน้า `/setup` ของ frontend ไว้แล้ว ต้องล้าง localStorage ของเบราว์เซอร์หรือกด setup ใหม่เพื่อรับ Store ID ล่าสุด

หลัง `init.sh` รันเสร็จ ให้เปิด service ที่เหลือเอง (ไม่ได้รันอัตโนมัติ เพราะเป็น dev server ที่ต้องดูอยู่ foreground):

```bash
cd frontend && npm run dev        # http://localhost:3000
cd print-agent && npm start       # http://localhost:9100
```

## Service URLs (ค่า default)

| Service | URL | หมายเหตุ |
|---|---|---|
| Backend (Django REST API) | http://localhost:8010 | mapped จาก container port 8000 |
| Postgres | localhost:5433 | mapped จาก container port 5432 |
| Frontend (Next.js PWA) | http://localhost:3000 | หน้าพนักงาน + self-order ลูกค้า |
| Print Agent | http://localhost:9100 | mock mode by default, ดู [print-agent](#print-agent) |
| Django admin | http://localhost:8010/admin/ | ต้องสร้าง superuser เอง (`manage.py createsuperuser`) |

> พอร์ต 5433/8010 (ไม่ใช่ 5432/8000 ตรงๆ) ถูกจงใจ map แบบนี้เพราะระหว่างพัฒนาเจอ port ชนกับโปรเจกต์อื่นในเครื่อง ถ้าเครื่องคุณไม่มีปัญหานี้ แก้กลับได้ใน [docker-compose.yml](docker-compose.yml)

## QR สั่งอาหารเองผ่าน LAN

ค่า default ทั้งหมด (`localhost`) ใช้ได้แค่ตอนเปิดจากเครื่องเดียวกับที่รันเซิร์ฟเวอร์ **มือถือลูกค้าจะเปิด `localhost` ไม่ได้เด็ดขาด** (ตีความเป็นตัวมันเองเสมอ) ถ้าจะให้ลูกค้าสแกน QR สั่งอาหารเองได้จริงจากมือถือบน WiFi เดียวกับร้าน ต้องตั้งค่าให้ชี้ไป LAN IP ของเครื่องที่รันเซิร์ฟเวอร์แทน:

1. หา LAN IP ของเครื่อง: `ipconfig getifaddr en0` (Mac) หรือดูจาก `ipconfig`/`hostname -I`
2. ใน backend `.env`: เพิ่ม IP นั้นเข้า `ALLOWED_HOSTS` และ `CORS_ALLOWED_ORIGINS`
3. ตั้งค่า URL ของ frontend/API ให้เป็น LAN IP แทน `localhost` — ถ้ารัน frontend ด้วย `npm run dev` ให้สร้าง `frontend/.env.local` ใส่ `NEXT_PUBLIC_API_BASE_URL=http://<LAN_IP>:8010`; ถ้ารันผ่าน `docker compose up` (ทั้ง stack) ให้ตั้ง `NEXT_PUBLIC_API_BASE_URL=http://<LAN_IP>:8080` ใน `.env` แล้ว `docker compose up -d --build frontend`
4. ที่หน้า `/setup` ของฝั่งพนักงาน ใส่ "URL สำหรับลูกค้าสแกน QR สั่งอาหารเอง" เป็น `http://<LAN_IP>:3000` — หรือจะเปิดหน้าพนักงานเองผ่าน LAN IP แทน `localhost` ตั้งแต่แรกก็พอ ไม่ต้องทำทั้งสองอย่าง (ระบบจะ auto-detect URL ปัจจุบันให้ถ้าช่องนี้ว่างไว้)

## ข้อมูล Login ทดสอบ (จาก `seed_demo`)

หลังรัน `init.sh` จะได้ร้านตัวอย่าง "ร้านทดสอบ xPOS" มาพร้อม:

- **Store ID**: พิมพ์ออกมาตอนท้ายของ `init.sh` (หรือดูใหม่ด้วย `docker compose run --rm backend python manage.py shell -c "from apps.tenancy.models import Store; print(Store.objects.first().id)"`)
- **Device ID**: `POS01`
- **PIN**: `1111` = OWNER, `2222` = SERVER
- โต๊ะ T1–T4 ในโซน "โซนหลัก", เมนู 3 รายการ (ผัดไทย/ข้าวผัด/ชาเย็น) พร้อม modifier "ระดับความเผ็ด"

เปิดใช้งาน: `http://localhost:3000` → กรอก API Base URL / Store ID / Device ID ที่หน้า `/setup` → login ด้วย PIN

## โครงสร้างโปรเจกต์

```
backend/        Django REST API — apps/{tenancy,staff,floor,menu,orders,audit,sync,common}
frontend/       Next.js PWA — POS หน้าร้าน + self-order ลูกค้า, Dexie.js สำหรับ offline-first
print-agent/    Local Print Agent (rule ข้อ 8) — รับ print job จาก PWA ผ่าน localhost แล้วส่งต่อเครื่องพิมพ์จริงใน LAN
scripts/        setup/init script
xpost-spec.md   สเป็คฉบับเต็ม (architecture rules, schema, flow)
```

## รัน Test

```bash
docker compose run --rm backend python manage.py test apps.orders -v 2
```

## Manual Setup (ถ้าไม่ใช้ init.sh)

```bash
cp .env.example .env
docker compose build backend
docker compose up -d db
docker compose run --rm backend python manage.py migrate
docker compose run --rm backend python manage.py seed_demo
docker compose up -d backend
cd frontend && npm install
cd ../print-agent && npm install
```

## Print Agent

รันแบบ mock เป็นค่า default (log ออก console + `print-agent/print-log.txt` แทนการพิมพ์จริง) เพราะไม่มีเครื่องพิมพ์ ESC/POS จริงให้ทดสอบ ถ้ามีเครื่องพิมพ์จริงในเครือข่าย ให้รันด้วย:

```bash
ENABLE_REAL_PRINTING=true npm start
```

## Store → Cloud sync (offline-first per store, §17 spec-xpost-gemini.md)

`docker-compose.yml` (this stack) runs entirely on the store's LAN and works fully
with or without internet. To also mirror this store's data up to a central cloud
deployment (`docker-compose.prod.yml`) every few hours, purely so the owner can review
it remotely:

```bash
# On the CLOUD deployment: generate a credential for this store
docker compose -f docker-compose.prod.yml run --rm backend \
  python manage.py generate_store_sync_key XPOS01

# On this STORE deployment: paste the printed value into .env
CLOUD_API_URL=https://xpos.example.com
CLOUD_SYNC_KEY=XPOS01:<secret printed above>
SYNC_INTERVAL_SECONDS=7200   # 1-3 hours, in seconds

docker compose up -d   # redis/celery-worker/celery-beat come up automatically
```

Menu/floor/staff master data is authored centrally at the cloud and pulled down here;
this store only ever pushes its own Orders up. Leaving `CLOUD_SYNC_KEY` blank (the
default) makes the sync task a no-op — nothing about normal order-taking, printing, or
payment depends on it. Run `docker compose run --rm backend python manage.py sync_now`
to trigger a sync immediately instead of waiting for the schedule.

## Known Phase 1 Limitations

- Offline-first เขียน local-first จริงเฉพาะ "เปิดโต๊ะ" และ "เพิ่มรายการ" — ยกเลิก/ส่วนลด/ลบรายการ/จ่ายเงิน ต้องออนไลน์
- Error handling ฝั่ง client ยังไม่แยกแยะ "เน็ตหลุด" กับ "server ตอบ error จริง" ออกจากกัน (ทั้งคู่ fallback ไปเขียน local เหมือนกัน)
- Print Agent ยังไม่เคยทดสอบกับเครื่องพิมพ์ ESC/POS จริง
- Service Worker cache เฉพาะ app shell พื้นฐาน ยังไม่เคยทดสอบ airplane mode จริง
- CORS origin ที่อนุญาตตั้งไว้ตรงใน `.env` (`CORS_ALLOWED_ORIGINS`) ต้องแก้เพิ่มเองถ้า frontend รันคนละพอร์ต
