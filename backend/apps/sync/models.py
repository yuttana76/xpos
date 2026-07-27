from django.db import models


class UpstreamSyncState(models.Model):
    """Singleton (id=1) — cursor ของ store-local backend ตอน sync ขึ้น/ลง cloud (§17 spec-xpost-gemini.md)
    อยู่ในฝั่ง store DB เท่านั้น ฝั่ง cloud DB มี table นี้เหมือนกัน (คนละ Django app เดียวกัน) แต่ไม่เคยถูกเติมข้อมูล"""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    last_pull_at = models.DateTimeField(null=True, blank=True)
    last_push_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(id=1)
        return obj
