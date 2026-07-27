from django.core.management.base import BaseCommand

from apps.sync.upstream import pull_from_cloud, push_orders_to_cloud


class Command(BaseCommand):
    help = "รัน pull_from_cloud() + push_orders_to_cloud() ทันที (sync_with_cloud_task ตัวเดียวกันแบบไม่รอ beat schedule) — ไว้ทดสอบด้วยมือ"

    def handle(self, *args, **options):
        self.stdout.write("pulling master data from cloud...")
        pull_from_cloud()
        self.stdout.write(self.style.SUCCESS("pull done"))

        self.stdout.write("pushing orders to cloud...")
        push_orders_to_cloud()
        self.stdout.write(self.style.SUCCESS("push done"))
