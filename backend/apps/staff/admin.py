from django import forms
from django.contrib import admin
from django.contrib.auth.hashers import make_password

from .models import Staff


class StaffAdminForm(forms.ModelForm):
    pin_code = forms.CharField(
        label="PIN code",
        required=False,
        widget=forms.PasswordInput(render_value=False),
        help_text="กรอกเฉพาะตอนต้องการตั้ง/เปลี่ยน PIN ใหม่ — ระบบจะ hash ให้อัตโนมัติ",
    )

    class Meta:
        model = Staff
        fields = ("store", "name", "role", "is_active", "pin_code", "additional_stores")

    def clean_pin_code(self):
        pin_code = self.cleaned_data.get("pin_code")
        if not pin_code and self.instance.pk is None:
            raise forms.ValidationError("จำเป็นต้องระบุ PIN code สำหรับพนักงานใหม่")
        return pin_code

    def save(self, commit=True):
        staff = super().save(commit=False)
        pin_code = self.cleaned_data.get("pin_code")
        if pin_code:
            staff.pin_code_hash = make_password(pin_code)
        if commit:
            staff.save()
        return staff


@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    form = StaffAdminForm
    list_display = ("name", "store", "role", "is_active", "updated_at")
    list_filter = ("store", "role", "is_active")
    search_fields = ("name",)
    filter_horizontal = ("additional_stores",)
