# نشر Leads Vault على VPS (Hostinger — Ubuntu 24.04)

معلومات المشروع المستخدمة في السكربتات:

| العنصر | القيمة |
| --- | --- |
| IP | 72.61.160.68 |
| المستخدم | root |
| المسار | /var/www/DATAHub |
| الدومين | data.tg-kw.com |
| بريد SSL | contact@tg-kw.com |
| المستودع | github.com/DEEBAIX/data-connect-hub |
| منفذ التطبيق | 3010 |
| منفذ الويبهوك | 8989 |

> مهم: هذا التطبيق **ليس SPA ثابتاً**. هو TanStack Start يعمل كخادم Node، لذلك Nginx يعمل
> كـ reverse proxy إلى المنفذ 3010 (لا `try_files`). الـ routing والـ API يعملان تلقائياً.

---

## سكربت 0 — قاعدة البيانات PostgreSQL على الـ VPS

```bash
#!/usr/bin/env bash
set -euo pipefail

apt update
apt install -y postgresql postgresql-contrib

DB_NAME=datahub
DB_USER=datahub
DB_PASS="$(openssl rand -hex 24)"

sudo -u postgres psql <<SQL
CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
SQL

# ضبط أداء مناسب لملفات الملايين من الصفوف (4 vCPU / 16GB)
PG_CONF=$(sudo -u postgres psql -tAc "SHOW config_file;")
cat >> "$PG_CONF" <<CONF
shared_buffers = 4GB
work_mem = 64MB
maintenance_work_mem = 1GB
effective_cache_size = 12GB
max_wal_size = 4GB
CONF
systemctl restart postgresql

echo "DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"
echo "احفظ هذا السطر — ستضعه في .env"
```

### نقل البيانات الحالية من Lovable Cloud إلى الـ VPS

من جهازك (يحتاج `pg_dump` نسخة 15+):

```bash
# 1) تصدير من Lovable Cloud (استخدم Cloud → Advanced settings → Export data
#    أو رابط الاتصال إن توفر لديك)
pg_dump "$SOURCE_DATABASE_URL" \
  --no-owner --no-privileges --schema=public -Fc -f datahub.dump

# 2) رفع الملف إلى الخادم
scp datahub.dump root@72.61.160.68:/root/

# 3) على الخادم: الاستعادة
pg_restore --no-owner --no-privileges -d "$DATABASE_URL" /root/datahub.dump
```

بعد الاستعادة تبقى كل الجداول كما هي: `countries, datasets, leads, dataset_columns,
column_definitions, saved_views, api_keys, api_key_scopes, api_usage_logs`.

---

## سكربت 1 — النشر الأول

```bash
#!/usr/bin/env bash
set -euo pipefail

GH_USER=DEEBAIX
GH_TOKEN=REPLACE_WITH_FINE_GRAINED_TOKEN
REPO=data-connect-hub
DOMAIN=data.tg-kw.com
EMAIL=contact@tg-kw.com
APP_DIR=/var/www/DATAHub
PORT=3010

apt update
apt install -y git curl nginx certbot python3-certbot-nginx
npm i -g pm2

mkdir -p /var/www
rm -rf "$APP_DIR"
git clone "https://${GH_USER}:${GH_TOKEN}@github.com/${GH_USER}/${REPO}.git" "$APP_DIR"
cd "$APP_DIR"

cat > .env <<ENV
NODE_ENV=production
PORT=${PORT}
DATABASE_URL=postgresql://datahub:PASSWORD@127.0.0.1:5432/datahub

# إن بقيت على Lovable Cloud مؤقتاً اترك هذه القيم كما في مشروع Lovable:
VITE_SUPABASE_URL=https://yzgstapzuuatxqiomdtm.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_MX7KU4y4r7OarTSf2ToF9w_etV5UBR1
VITE_SUPABASE_PROJECT_ID=yzgstapzuuatxqiomdtm
SUPABASE_URL=https://yzgstapzuuatxqiomdtm.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_MX7KU4y4r7OarTSf2ToF9w_etV5UBR1
SUPABASE_SERVICE_ROLE_KEY=REPLACE_IF_SELF_HOSTED
ENV
chmod 600 .env

npm install
npm run build

pm2 delete datahub 2>/dev/null || true
set -a
source .env
set +a
PORT=$PORT pm2 start ".output/server/index.mjs" --name datahub --update-env
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

cat > /etc/nginx/sites-available/${DOMAIN} <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 0;      # الرفع يتم على دفعات، لكن نرفع الحد احتياطاً
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}
nginx -t && systemctl reload nginx

certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m ${EMAIL} --redirect
systemctl reload nginx

echo "تم: https://${DOMAIN}"
```

> ملاحظة: إن كان مخرج البناء باسم مختلف، شغّل `ls .output/server/` واستبدل المسار في أمر PM2.

---

## سكربت 2 — إعادة النشر بعد أي تعديل من Lovable

احفظه في `/usr/local/bin/redeploy` ثم `chmod +x /usr/local/bin/redeploy`، وشغّله بأمر واحد:
`redeploy`

```bash
#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/var/www/DATAHub
cd "$APP_DIR"

git fetch --all
git reset --hard origin/main
npm install
npm run build
set -a
source .env
set +a
pm2 restart datahub --update-env
pm2 save
echo "✅ redeploy done: $(git rev-parse --short HEAD)"
```

---

## سكربت 3 — نشر تلقائي عبر GitHub Webhook

```bash
mkdir -p /opt/deploy-hook && cd /opt/deploy-hook
npm init -y >/dev/null
cat > server.js <<'JS'
const http = require("http");
const crypto = require("crypto");
const { exec } = require("child_process");

const SECRET = process.env.WEBHOOK_SECRET;
const PORT = Number(process.env.PORT || 8989);

http
  .createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/deploy") {
      res.writeHead(404).end("not found");
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const sig = req.headers["x-hub-signature-256"] || "";
      const expected =
        "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
      const a = Buffer.from(String(sig));
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.writeHead(401).end("bad signature");
        return;
      }
      const payload = JSON.parse(body || "{}");
      if (payload.ref && payload.ref !== "refs/heads/main") {
        res.writeHead(200).end("ignored branch");
        return;
      }
      res.writeHead(202).end("deploying");
      exec("/usr/local/bin/redeploy", (err, stdout, stderr) => {
        console.log(stdout || "", stderr || "", err ? String(err) : "");
      });
    });
  })
  .listen(PORT, () => console.log("webhook listening on " + PORT));
JS

WEBHOOK_SECRET="$(openssl rand -hex 32)"
echo "WEBHOOK_SECRET=$WEBHOOK_SECRET"   # انسخه لصفحة GitHub
WEBHOOK_SECRET=$WEBHOOK_SECRET PORT=8989 pm2 start server.js --name deploy-hook --update-env
pm2 save
ufw allow 8989/tcp || true
```

إعداد GitHub: Repo → Settings → Webhooks → Add webhook

- Payload URL: `http://72.61.160.68:8989/deploy`
- Content type: `application/json`
- Secret: القيمة المطبوعة أعلاه
- Events: Just the push event

بعدها: أي تعديل تعمله في Lovable → يذهب إلى GitHub → الخادم يبني وينشر تلقائياً خلال دقيقة.

---

## الأسئلة المتكررة

**هل أستمر بالتعديل من Lovable بعد النشر؟** نعم. Lovable → GitHub → `redeploy` (أو تلقائياً
عبر الويبهوك). الكود يتحدّث بالكامل، والبيانات لا تُمَس.

**هل تُقرأ قاعدة بيانات الـ VPS داخل Lovable؟** لا. معاينة Lovable تبقى مرتبطة بقاعدة
بيانات Lovable Cloud، ونسخة الـ VPS تقرأ قاعدة بيانات الـ VPS. هما بيئتان منفصلتان:
نفس الكود، بيانات مختلفة. الرفع الحقيقي للبيانات يجب أن يتم من `https://data.tg-kw.com`.

**رفع ملفات ضخمة (1–4 جيجا):** الملف لا يُرفع إلى الخادم إطلاقاً. المتصفح يقرأه بالتدفق
ويرسل دفعات 5000 صف إلى الخادم، لذلك لا يوجد حد لحجم الملف — فقط اترك التبويب مفتوحاً حتى
انتهاء الشريط. ملفات CSV/TXT/TSV هي الأسرع؛ XLSX/JSON تُقرأ كاملة في ذاكرة المتصفح لذلك
حوّلها إلى CSV إن تجاوزت ~80MB:

```bash
# تحويل XLSX ضخم إلى CSV على الخادم
pip install xlsx2csv && xlsx2csv big.xlsx big.csv
```

**استيراد مباشر من الطرفية (أسرع طريقة لملف 4 جيجا):**

```bash
psql "$DATABASE_URL" <<'SQL'
CREATE TEMP TABLE staging (full_name text, phone text, email text, city text, company text);
\copy staging FROM '/root/big.csv' WITH (FORMAT csv, HEADER true);
INSERT INTO leads (dataset_id, country_code, full_name, phone, email, city, company)
SELECT '<DATASET_UUID>', 'KW', full_name, phone, lower(email), city, company FROM staging
ON CONFLICT DO NOTHING;
SQL
```
