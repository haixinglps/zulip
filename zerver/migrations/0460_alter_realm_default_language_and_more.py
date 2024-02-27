# Generated by Django 4.2.2 on 2024-02-27 05:33

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("zerver", "0459_alter_realm_default_language"),
    ]

    operations = [
        migrations.AlterField(
            model_name="realm",
            name="default_language",
            field=models.CharField(default="zh-Hans", max_length=50),
        ),
        migrations.AlterField(
            model_name="realmuserdefault",
            name="default_language",
            field=models.CharField(default="zh-Hans", max_length=50),
        ),
        migrations.AlterField(
            model_name="userprofile",
            name="default_language",
            field=models.CharField(default="zh-Hans", max_length=50),
        ),
    ]
