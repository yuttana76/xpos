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
