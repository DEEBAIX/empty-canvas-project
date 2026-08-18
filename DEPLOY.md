# نشر DATAHub مستقلاً على VPS

هذا المشروع يستخدم على خادم الإنتاج قاعدة البيانات والمصادقة وData API محلياً. معاينة Lovable تبقى منفصلة ولا تتزامن بياناتها تلقائياً مع الإنتاج.

## الملف الصحيح

استخدم الملف غير المضغوط:

```text
0e42e42f-136c-40df-9ff7-ff7c87340d77_260817.backup
```

ملف `.zip` يحتوي النسخة نفسها فقط. لا تستعد الملف يدوياً بـ `pg_restore`؛ السكربت ينشئ الخدمات المطلوبة، يستعيد النسخة في قاعدة مؤقتة، يفحصها، ثم يعتمدها.

## النشر والاستعادة بأمر واحد

بعد رفع ملف `.backup` إلى `/root/`، ادخل إلى مجلد المشروع وشغّل:

```bash
cd /var/www/DATAHub
chmod +x deploy-all.sh
sudo bash deploy-all.sh /root/0e42e42f-136c-40df-9ff7-ff7c87340d77_260817.backup
```

السكربت يتولى تلقائياً:

- تثبيت Node 20 وPM2 وDocker وNginx وCertbot.
- تشغيل PostgreSQL 17 والمصادقة وData API محلياً.
- استعادة مستخدمي الدخول وجداول التطبيق والبيانات من النسخة.
- حفظ الأسرار في `/root/.datahub-deploy.env` بصلاحيات root فقط.
- بناء تطبيق TanStack Start وتشغيله على PM2.
- توجيه Nginx وإصدار SSL وفحص الموقع من البداية إلى النهاية.
- إنشاء نسخة أمان قبل استبدال أي قاعدة VPS موجودة.

لا تغلق جلسة SSH حتى تظهر الرسالة `Deployment completed successfully`.

## التحقق

```bash
curl -I https://data.tg-kw.com/
curl https://data.tg-kw.com/auth/v1/health
cat /opt/datahub-backend/restore-counts.txt
pm2 status
docker compose --project-directory /opt/datahub-backend --project-name datahub-backend ps
```

الملف `restore-counts.txt` يعرض أعداد المستخدمين والأدوار والدول والمجموعات والليدز التي قُبلت بعد الاستعادة.

## التحديثات اللاحقة

بعد وصول تعديل جديد إلى GitHub:

```bash
redeploy
```

هذا يحدث الكود فقط، ولا يعيد استيراد النسخة ولا يحذف البيانات.

## GitHub Webhook اختياري

بعد نجاح النشر، أنشئ Webhook بإعدادات:

- Payload URL: `https://data.tg-kw.com/deploy-webhook`
- Content type: `application/json`
- Event: Push فقط
- Secret: القيمة `WEBHOOK_SECRET` المحفوظة في `/root/.datahub-deploy.env`

لا ترسل قيمة السر إلى المحادثة ولا تضعها داخل Git.

## عند حدوث خطأ

```bash
pm2 logs datahub --lines 150 --nostream
docker compose --project-directory /opt/datahub-backend --project-name datahub-backend ps
docker compose --project-directory /opt/datahub-backend --project-name datahub-backend logs --tail 150 auth rest api-gw db
sudo nginx -t
```

إذا فشلت الاستعادة، يتوقف السكربت قبل اعتماد القاعدة المؤقتة. وإذا كانت هناك قاعدة سابقة، تحفظ نسخة منها في `/root/datahub-before-restore-<date>.backup`.

## ملاحظتان مهمتان

1. استعادة قاعدة البيانات لا تصلح خطأ تطبيق Node وحدها؛ لذلك ينفذ السكربت فحوصاً منفصلة للتطبيق والمصادقة وData API وNginx ويعرض سجل PM2 عند الفشل.
2. النسخة تستعيد بيانات جداول Storage، لكنها لا تضمن وجود الملفات الثنائية المخزنة خارج قاعدة البيانات. منصة DATAHub الحالية تقرأ ملفات الاستيراد من المتصفح ولا تعتمد على ملفات Storage محفوظة.