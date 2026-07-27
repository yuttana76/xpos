import uuid

from django.db import models

from apps.tenancy.models import Store


class Zone(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="zones")
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Table(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "AVAILABLE", "ว่าง"
        OCCUPIED = "OCCUPIED", "มีลูกค้า"
        RESERVED = "RESERVED", "จอง"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    zone = models.ForeignKey(Zone, on_delete=models.CASCADE, related_name="tables")
    name = models.CharField(max_length=50)
    seats = models.IntegerField(default=4)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AVAILABLE)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.zone.name} / {self.name}"
