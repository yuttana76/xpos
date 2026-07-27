from rest_framework.permissions import BasePermission

from apps.staff.models import Staff


class IsStaffAuthenticated(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and getattr(request.user, "is_authenticated", False))


class IsOwnerOrManager(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and getattr(user, "is_authenticated", False)):
            return False
        return user.role in (Staff.Role.OWNER, Staff.Role.MANAGER)


class IsOwner(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and getattr(user, "is_authenticated", False)):
            return False
        return user.role == Staff.Role.OWNER


class IsStoreSyncAuthenticated(BasePermission):
    """ใช้เฉพาะ endpoint ที่ store-local backend เรียก sync ขึ้น cloud (StoreSyncKeyAuthentication) เท่านั้น"""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and getattr(user, "is_authenticated", False)
            and getattr(user, "is_store_principal", False)
        )
