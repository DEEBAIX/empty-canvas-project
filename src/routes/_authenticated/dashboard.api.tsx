import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard/api")({
  component: ApiDocs,
});

function Block({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-bold">{title}</h3>
      <pre
        dir="ltr"
        className="mt-3 overflow-x-auto rounded-xl bg-background p-4 text-xs leading-relaxed"
      >
        {code}
      </pre>
    </div>
  );
}

function ApiDocs() {
  const [origin, setOrigin] = useState("https://your-app.lovable.app");
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">دليل الـ API</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          كل الطلبات تحتاج ترويسة <code dir="ltr">Authorization: Bearer &lt;API_KEY&gt;</code> أو{" "}
          <code dir="ltr">x-api-key</code>.
        </p>
      </div>

      <Block
        title="جلب الليدز (مع فلترة و pagination)"
        code={`GET ${origin}/api/public/v1/leads?country=KW&limit=1000&cursor=0

curl -H "Authorization: Bearer lk_live_xxx" \\
  "${origin}/api/public/v1/leads?country=KW&limit=1000"

# المعاملات:
#   country       رمز الدولة (KW, AE, QA ...)
#   dataset       معرّف مجموعة محددة
#   limit         1..1000 (افتراضي 100)
#   cursor        آخر id من الصفحة السابقة (next_cursor)
#   updated_since ISO date — لجلب الجديد/المعدّل فقط
#   search        بحث نصي

# الاستجابة:
{
  "data": [
    { "id": 1, "country_code": "KW", "full_name": "...", "phone": "+9655xxxxxxx",
      "email": "...", "city": "...", "company": "...", "extra": {}, "updated_at": "..." }
  ],
  "count": 1000,
  "next_cursor": 1000
}`}
      />

      <Block
        title="عدد الليدز"
        code={`GET ${origin}/api/public/v1/count?country=AE

curl -H "Authorization: Bearer lk_live_xxx" "${origin}/api/public/v1/count?country=AE"
# => { "count": 482913 }`}
      />

      <Block
        title="الدول المتاحة لهذا المفتاح"
        code={`GET ${origin}/api/public/v1/countries

curl -H "Authorization: Bearer lk_live_xxx" "${origin}/api/public/v1/countries"
# => { "data": [ { "country": "KW", "leads": 120000 } ] }`}
      />

      <Block
        title="مثال JavaScript — سحب كل البيانات صفحة بصفحة"
        code={`let cursor = 0;
while (true) {
  const res = await fetch(
    \`${origin}/api/public/v1/leads?country=KW&limit=1000&cursor=\${cursor}\`,
    { headers: { Authorization: "Bearer lk_live_xxx" } }
  );
  const json = await res.json();
  process(json.data);
  if (!json.next_cursor) break;
  cursor = json.next_cursor;
}`}
      />

      <div className="rounded-2xl border border-border bg-card p-5 text-sm">
        <h3 className="font-bold">الفلترة من طرف المنصة الأخرى (Data Filter عبر API)</h3>
        <p className="mt-2 text-muted-foreground">
          كل عمود في ملفاتك قابل للفلترة — الأعمدة الأساسية والأعمدة الخاصة بالملف على حد سواء.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-background p-3 text-xs" dir="ltr">
{`GET /api/public/v1/schema                 # اكتشاف المجموعات والأعمدة المتاحة للمفتاح
GET /api/public/v1/leads?filter[city][eq]=Kuwait
GET /api/public/v1/leads?filter[phone][notempty]=1&fields=full_name,phone
GET /api/public/v1/leads?filter[facebook_id][contains]=100
GET /api/public/v1/leads?filter[email][in]=a@x.com,b@x.com

# العمليات المتاحة:
# eq | contains | starts | ends | in | empty | notempty | gte | lte`}
        </pre>
        <p className="mt-3 text-muted-foreground">
          <b>fields</b> تحدد الأعمدة المُعادة. وإذا رُبط المفتاح بفلتر محفوظ (View) من صفحة
          «فلترة البيانات» فسيُطبَّق تلقائياً على كل طلب.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 text-sm">
        <h3 className="font-bold">أكواد الأخطاء</h3>
        <ul className="mt-3 space-y-1 text-muted-foreground">
          <li>401 — مفتاح مفقود أو غير صحيح</li>
          <li>403 — المفتاح موقوف أو منتهي أو غير مصرّح له بهذه الدولة/المجموعة</li>
          <li>429 — تجاوز حد الطلبات في الساعة</li>
          <li>500 — خطأ داخلي</li>
        </ul>
      </div>

    </div>
  );
}
