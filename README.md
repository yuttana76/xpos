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

## Known Phase 1 Limitations

- Offline-first เขียน local-first จริงเฉพาะ "เปิดโต๊ะ" และ "เพิ่มรายการ" — ยกเลิก/ส่วนลด/ลบรายการ/จ่ายเงิน ต้องออนไลน์
- Error handling ฝั่ง client ยังไม่แยกแยะ "เน็ตหลุด" กับ "server ตอบ error จริง" ออกจากกัน (ทั้งคู่ fallback ไปเขียน local เหมือนกัน)
- Print Agent ยังไม่เคยทดสอบกับเครื่องพิมพ์ ESC/POS จริง
- Service Worker cache เฉพาะ app shell พื้นฐาน ยังไม่เคยทดสอบ airplane mode จริง
- CORS origin ที่อนุญาตตั้งไว้ตรงใน `.env` (`CORS_ALLOWED_ORIGINS`) ต้องแก้เพิ่มเองถ้า frontend รันคนละพอร์ต
