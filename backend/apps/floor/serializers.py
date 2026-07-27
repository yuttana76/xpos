from rest_framework import serializers

from .models import Table, Zone


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = ["id", "name", "is_active", "updated_at"]
        read_only_fields = ["id", "updated_at"]


class TableSerializer(serializers.ModelSerializer):
    class Meta:
        model = Table
        fields = ["id", "zone", "name", "seats", "status", "is_active", "updated_at"]
        read_only_fields = ["id", "status", "updated_at"]
