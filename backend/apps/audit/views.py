from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import mixins, viewsets

from apps.common.permissions import IsOwnerOrManager

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    # ไม่มี create/update/delete ผ่าน API — AuditLog เกิดได้จาก sync push หรือ server เขียนเองเท่านั้น
    permission_classes = [IsOwnerOrManager]
    serializer_class = AuditLogSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["action", "staff", "target_model", "target_id"]

    def get_queryset(self):
        # store scoping ตาม rule ข้อ 5 — ห้าม trust store_id จาก client, ผูกกับ JWT เท่านั้น
        return AuditLog.objects.filter(store_id=self.request.user.store_id).order_by("-created_at")
