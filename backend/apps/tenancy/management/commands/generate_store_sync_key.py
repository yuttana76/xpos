import secrets

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError

from apps.tenancy.models import Store


class Command(BaseCommand):
    help = (
        "สร้าง/หมุน sync key ของร้าน สำหรับให้ store-local backend ใช้ authenticate ตอน sync ขึ้น cloud "
        "(StoreSyncKeyAuthentication) — พิมพ์ค่าเต็ม 'store_code:secret' ออกมาครั้งเดียว เอาไปใส่ CLOUD_SYNC_KEY "
        "ใน .env ของร้านนั้น"
    )

    def add_arguments(self, parser):
        parser.add_argument("store_code", type=str)

    def handle(self, *args, **options):
        store_code = options["store_code"]
        try:
            store = Store.objects.get(store_code=store_code)
        except Store.DoesNotExist:
            raise CommandError(f"ไม่พบร้านที่ store_code={store_code}")

        secret = secrets.token_urlsafe(32)
        store.sync_key_hash = make_password(secret)
        store.save(update_fields=["sync_key_hash", "updated_at"])

        credential = f"{store_code}:{secret}"
        self.stdout.write(self.style.SUCCESS("สร้าง sync key สำเร็จ — บันทึกไว้เดี๋ยวนี้ จะไม่แสดงซ้ำอีก:"))
        self.stdout.write(credential)
        self.stdout.write("ใส่ค่านี้เป็น CLOUD_SYNC_KEY ใน .env ของ store-local deployment")
