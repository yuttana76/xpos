import logging

import requests
from celery import shared_task
from django.conf import settings

from .upstream import pull_from_cloud, push_orders_to_cloud

logger = logging.getLogger(__name__)


@shared_task(
    autoretry_for=(requests.RequestException,),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=5,
)
def sync_with_cloud_task():
    """รันเป็นรอบผ่าน Celery beat (CELERY_BEAT_SCHEDULE, ทุก SYNC_INTERVAL_SECONDS วิ) — no-op เมื่อยังไม่ตั้ง
    ค่า CLOUD_API_URL/CLOUD_SYNC_KEY เช่นตอนรันเป็น cloud deployment เอง (§17 spec-xpost-gemini.md)"""
    if not settings.CLOUD_API_URL or not settings.CLOUD_SYNC_KEY:
        logger.info("sync_with_cloud_task: CLOUD_API_URL/CLOUD_SYNC_KEY not set, skipping")
        return

    pull_from_cloud()
    push_orders_to_cloud()
