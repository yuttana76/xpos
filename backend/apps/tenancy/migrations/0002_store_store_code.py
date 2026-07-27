from django.db import migrations, models


def backfill_store_code(apps, schema_editor):
    Store = apps.get_model("tenancy", "Store")
    for store in Store.objects.all():
        store.store_code = str(store.id).split("-")[0].upper()
        store.save(update_fields=["store_code"])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("tenancy", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="store",
            name="store_code",
            field=models.CharField(max_length=20, null=True, blank=True, unique=False),
        ),
        migrations.RunPython(backfill_store_code, noop),
        migrations.AlterField(
            model_name="store",
            name="store_code",
            field=models.CharField(
                max_length=20,
                unique=True,
                help_text="รหัสร้านสั้นๆ ใช้แทน UUID ตอนตั้งค่าอุปกรณ์/login เช่น XPOS01",
            ),
        ),
    ]
