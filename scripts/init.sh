#!/usr/bin/env bash
# ตั้งค่าโปรเจกต์ xPOS ทั้งหมดให้พร้อมใช้งานครั้งแรก (หรือหลัง clone ใหม่)
#
# ทำ: สร้าง .env, ตั้ง Docker (db + backend), migrate, seed ข้อมูลตัวอย่าง,
#     ติดตั้ง dependency ของ frontend และ print-agent
#
# ใช้งาน:
#   ./scripts/init.sh            # setup ปกติ (ข้ามถ้ามี .env อยู่แล้ว)
#   ./scripts/init.sh --reset    # ลบข้อมูลเดิมทั้งหมดแล้วเริ่มใหม่ (ล้าง volume Postgres)
#   ./scripts/init.sh --seed-only  # แค่รัน seed_demo ใหม่ (เผื่อข้อมูลตัวอย่างพัง)

set -euo pipefail
cd "$(dirname "$0")/.."

RESET=false
SEED_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=true ;;
    --seed-only) SEED_ONLY=true ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

log() { echo -e "\033[1;36m==>\033[0m $1"; }

if [ "$SEED_ONLY" = true ]; then
  log "รัน seed_demo ใหม่เท่านั้น"
  docker compose run --rm backend python manage.py seed_demo
  exit 0
fi

if [ ! -f .env ]; then
  log "ยังไม่มี .env — คัดลอกจาก .env.example"
  cp .env.example .env
else
  log ".env มีอยู่แล้ว ใช้ค่าเดิม"
fi

if [ "$RESET" = true ]; then
  log "--reset: ลบ container และ volume Postgres เดิมทั้งหมด"
  docker compose down -v
  echo "  หมายเหตุ: --reset จะได้ Store ID ใหม่เสมอ — ถ้าเคยตั้งค่าอุปกรณ์ใน frontend (/setup) ไว้แล้ว"
  echo "  ต้องล้าง localStorage ของเบราว์เซอร์ (หรือกด setup ใหม่) เพื่อรับ Store ID ล่าสุด"
fi

log "เช็ค port ที่ docker-compose.yml ใช้ ว่าไม่ชนกับ service อื่นในเครื่อง (นอกเหนือจาก container ของโปรเจกต์นี้เอง)"
for port_mapping in "5433:Postgres:db" "8010:Django backend:backend"; do
  port="${port_mapping%%:*}"
  rest="${port_mapping#*:}"
  name="${rest%%:*}"
  service="${rest##*:}"
  owner_pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
  if [ -n "$owner_pid" ]; then
    # ถ้า docker compose ของโปรเจกต์นี้เป็นเจ้าของ container ที่ครอง port นี้อยู่แล้ว ไม่ต้องเตือน
    if ! docker compose ps "$service" --format '{{.State}}' 2>/dev/null | grep -q running; then
      echo "  คำเตือน: port $port ($name) ถูกใช้งานอยู่แล้วโดยโปรเซสอื่น (PID $owner_pid) — แก้ไขใน docker-compose.yml ก่อนถ้าชนกัน"
    fi
  fi
done

log "build backend image (ถ้ายังไม่เคย build หรือ requirements.txt เปลี่ยน)"
docker compose build backend

log "เริ่ม Postgres และรอจนกว่าจะ healthy"
docker compose up -d db
for i in $(seq 1 30); do
  status=$(docker inspect --format='{{.State.Health.Status}}' xpos-db-1 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then
    break
  fi
  sleep 2
done
if [ "$status" != "healthy" ]; then
  echo "Postgres ไม่ขึ้น healthy ภายในเวลาที่กำหนด — เช็ค docker compose logs db" >&2
  exit 1
fi

log "รัน migrate"
docker compose run --rm backend python manage.py migrate

log "seed ข้อมูลตัวอย่าง (ร้านทดสอบ, พนักงาน, โต๊ะ, เมนู)"
docker compose run --rm backend python manage.py seed_demo

log "เริ่ม backend server"
docker compose up -d backend

if [ -d frontend/node_modules ]; then
  log "frontend: node_modules มีอยู่แล้ว ข้ามการติดตั้ง"
else
  log "ติดตั้ง frontend dependencies (npm install)"
  (cd frontend && npm install)
fi

if [ -d print-agent/node_modules ]; then
  log "print-agent: node_modules มีอยู่แล้ว ข้ามการติดตั้ง"
else
  log "ติดตั้ง print-agent dependencies (npm install)"
  (cd print-agent && npm install)
fi

echo
log "เสร็จแล้ว — ระบบพร้อมใช้งาน"
echo "  Backend:      http://localhost:8010"
echo "  Frontend:     cd frontend && npm run dev   (แล้วเปิด http://localhost:3000)"
echo "  Print Agent:  cd print-agent && npm start  (แล้วรันที่ http://localhost:9100)"
echo
echo "ข้อมูล login ทดสอบ (จาก seed_demo):"
docker compose run --rm backend python manage.py shell -c "
from apps.tenancy.models import Store
s = Store.objects.first()
print(f'  Store ID: {s.id}') if s else print('  ไม่พบ store — ตรวจสอบ seed_demo')
print('  Device ID: POS01')
print('  PIN: 1111 (owner) หรือ 2222 (server)')
"
