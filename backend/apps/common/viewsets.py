from rest_framework import mixins, viewsets


class SoftDeleteModelViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """ModelViewSet ที่ไม่มี DELETE — master data (Zone/Table/Category/MenuItem ฯลฯ) sync ลง
    client ผ่าน incremental pull (updated_at__gt=since) เท่านั้น การ hard delete จะทำให้ record
    หายไปจาก server เงียบๆ โดย client ที่ sync ไปแล้วไม่มีทางรู้และจะโชว์ข้อมูลผีค้างตลอดไป —
    ต้องปิดใช้งานด้วย is_active=False (soft delete) แทน ซึ่งมี updated_at bump ให้ sync ปกติ
    """

    pass
