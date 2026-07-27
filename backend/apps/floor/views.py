from rest_framework.exceptions import ValidationError

from apps.common.permissions import IsOwner
from apps.common.viewsets import SoftDeleteModelViewSet

from .models import Table, Zone
from .serializers import TableSerializer, ZoneSerializer


class ZoneViewSet(SoftDeleteModelViewSet):
    """CRUD โซนของร้าน — เฉพาะ OWNER ตั้งค่าผังร้านได้"""

    permission_classes = [IsOwner]
    serializer_class = ZoneSerializer

    def get_queryset(self):
        return Zone.objects.filter(store_id=self.request.user.store_id).order_by("name")

    def perform_create(self, serializer):
        serializer.save(store_id=self.request.user.store_id)


class TableViewSet(SoftDeleteModelViewSet):
    """CRUD โต๊ะของร้าน — เฉพาะ OWNER ตั้งค่าผังร้านได้"""

    permission_classes = [IsOwner]
    serializer_class = TableSerializer

    def get_queryset(self):
        return Table.objects.filter(zone__store_id=self.request.user.store_id).order_by(
            "zone__name", "name"
        )

    def perform_create(self, serializer):
        zone = serializer.validated_data["zone"]
        if str(zone.store_id) != str(self.request.user.store_id):
            raise ValidationError({"zone": "โซนนี้ไม่ได้อยู่ในร้านของคุณ"})
        serializer.save()

    def perform_update(self, serializer):
        zone = serializer.validated_data.get("zone", serializer.instance.zone)
        if str(zone.store_id) != str(self.request.user.store_id):
            raise ValidationError({"zone": "โซนนี้ไม่ได้อยู่ในร้านของคุณ"})
        serializer.save()
