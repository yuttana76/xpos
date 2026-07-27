from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = [
            "id",
            "staff",
            "action",
            "device_id",
            "target_model",
            "target_id",
            "before_data",
            "after_data",
            "created_at",
        ]
