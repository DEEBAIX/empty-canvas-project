#!/usr/bin/env bash
# ============================================================
#  Leads Vault / DATAHub - سكربت نشر واحد شامل
#  VPS: Ubuntu 24.04 (Hostinger)  |  Domain: data.tg-kw.com
#  يشمل: PostgreSQL + Node20 + Clone + Build + PM2 + Nginx + SSL + Webhook
#  التشغيل:  bash deploy-all.sh
# ============================================================
set -euo pipefail

# ---------- 1) الإعدادات (عدّل هذه القيم فقط) ----------
GH_USER="DEEBAIX"
GH_TOKEN="REPLACE_WITH_FINE_GRAINED_TOKEN"   # توكن GitHub (repo read)
REPO="data-connect-hub"
BRANCH="main"

DOMAIN="data.tg-kw.com"
EMAIL="contact@tg-kw.com"
APP_DIR="/var/www/DATAHub"
APP_NAME="datahub"
PORT="3010"
HOOK_PORT="8989"

DB_NAME="datahub"
DB_USER="datahub"

# اتركها كما هي إن أردت الاستمرار على قاعدة Lovable Cloud مؤقتاً
VITE_SUPABASE_URL="https://yzgstapzuuatxqiomdtm.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_MX7KU4y4r7OarTSf2ToF9w_etV5UBR1"
VITE_SUPABASE_PROJECT_ID="yzgstapzuuatxqiomdtm"

STATE_FILE="/root/.datahub-deploy.env"
say(){ echo -e "\n\033[1;36m==> $*\033[0m"; }

# ---------- 2) الحزم الأساسية ----------
say "تثبيت الحزم الأساسية"
export DEBIAN_FRONTEND=noninteractive
apt update -y
apt install -y git curl ca-certificates ufw nginx certbot python3-certbot-nginx postgresql postgresql-contrib

if ! command -v node >/dev/null 2>&1; then
  say "تثبيت Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
command -v pm2 >/dev/null 2>&1 || npm i -g pm2

# ---------- 3) PostgreSQL ----------
say "إعداد قاعدة البيانات PostgreSQL"
systemctl enable --now postgresql

if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

if [ -z "${DB_PASS:-}" ]; then
  DB_PASS="$(openssl rand -hex 24)"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"

# ضبط الأداء (مرة واحدة فقط)
PG_CONF="$(sudo -u postgres psql -tAc 'SHOW config_file;')"
if ! grep -q "# datahub-tuning" "$PG_CONF"; then
  cat >> "$PG_CONF" <<CONF

# datahub-tuning
shared_buffers = 4GB
work_mem = 64MB
maintenance_work_mem = 1GB
effective_cache_size = 12GB
max_wal_size = 4GB
CONF
  systemctl restart postgresql
fi

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"

# ---------- 4) جلب الكود ----------
say "جلب الكود من GitHub"
mkdir -p /var/www
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch --all
  git reset --hard "origin/${BRANCH}"
else
  rm -rf "$APP_DIR"
  git clone -b "$BRANCH" "https://${GH_USER}:${GH_TOKEN}@github.com/${GH_USER}/${REPO}.git" "$APP_DIR"
  cd "$APP_DIR"
fi

# ---------- 5) ملف البيئة ----------
say "كتابة ملف .env"
cat > "$APP_DIR/.env" <<ENV
NODE_ENV=production
PORT=${PORT}
DATABASE_URL=${DATABASE_URL}

VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
VITE_SUPABASE_PROJECT_ID=${VITE_SUPABASE_PROJECT_ID}
SUPABASE_URL=${VITE_SUPABASE_URL}
SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
ENV
chmod 600 "$APP_DIR/.env"

# ---------- 6) البناء والتشغيل بـ PM2 ----------
say "تثبيت الاعتماديات والبناء"
npm install
npm run build

ENTRY=""
for c in ".output/server/index.mjs" ".output/server/index.js" "dist/server/index.mjs"; do
  [ -f "$APP_DIR/$c" ] && ENTRY="$APP_DIR/$c" && break
done
if [ -z "$ENTRY" ]; then
  echo "!! لم أجد مخرج البناء. شغّل: ls -R $APP_DIR/.output/server | head" >&2
  exit 1
fi

say "تشغيل التطبيق عبر PM2 ($ENTRY)"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
cd "$APP_DIR"
set -a
source "$APP_DIR/.env"
set +a
PORT="$PORT" NODE_ENV=production pm2 start "$ENTRY" --name "$APP_NAME" --update-env
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

# ---------- 7) Nginx (reverse proxy — ليس SPA) ----------
say "إعداد Nginx"
cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 0;
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
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t && systemctl reload nginx

say "إصدار شهادة SSL"
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect || \
  echo "!! تخطّي SSL: تأكد أن الدومين يشير إلى IP الخادم ثم أعد: certbot --nginx -d ${DOMAIN}"
systemctl reload nginx

# ---------- 8) أمر redeploy ----------
say "تثبيت أمر redeploy"
cat > /usr/local/bin/redeploy <<RD
#!/usr/bin/env bash
set -euo pipefail
cd ${APP_DIR}
git fetch --all
git reset --hard origin/${BRANCH}
npm install
npm run build
set -a
source ${APP_DIR}/.env
set +a
pm2 restart ${APP_NAME} --update-env
pm2 save
echo "redeploy done: \$(git rev-parse --short HEAD)"
RD
chmod +x /usr/local/bin/redeploy

# ---------- 9) ويبهوك GitHub للنشر التلقائي ----------
say "إعداد ويبهوك النشر التلقائي"
mkdir -p /opt/deploy-hook && cd /opt/deploy-hook
[ -f package.json ] || npm init -y >/dev/null
cat > server.js <<'JS'
const http = require("http");
const crypto = require("crypto");
const { exec } = require("child_process");
const SECRET = process.env.WEBHOOK_SECRET;
const PORT = Number(process.env.PORT || 8989);
http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/deploy") { res.writeHead(404).end("not found"); return; }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const sig = String(req.headers["x-hub-signature-256"] || "");
    const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { res.writeHead(401).end("bad signature"); return; }
    const payload = JSON.parse(body || "{}");
    if (payload.ref && payload.ref !== "refs/heads/main") { res.writeHead(200).end("ignored branch"); return; }
    res.writeHead(202).end("deploying");
    exec("/usr/local/bin/redeploy", (err, out, errout) => console.log(out || "", errout || "", err ? String(err) : ""));
  });
}).listen(PORT, () => console.log("webhook listening on " + PORT));
JS

if [ -z "${WEBHOOK_SECRET:-}" ]; then WEBHOOK_SECRET="$(openssl rand -hex 32)"; fi
pm2 delete deploy-hook >/dev/null 2>&1 || true
WEBHOOK_SECRET="$WEBHOOK_SECRET" PORT="$HOOK_PORT" pm2 start server.js --name deploy-hook --update-env
pm2 save
ufw allow "${HOOK_PORT}"/tcp >/dev/null 2>&1 || true

# ---------- 10) حفظ الأسرار وطباعة الخلاصة ----------
cat > "$STATE_FILE" <<S
DB_PASS=${DB_PASS}
DATABASE_URL=${DATABASE_URL}
WEBHOOK_SECRET=${WEBHOOK_SECRET}
S
chmod 600 "$STATE_FILE"

cat <<EOF

=========== تم النشر بنجاح ===========
الموقع        : https://${DOMAIN}
DATABASE_URL  : ${DATABASE_URL}
WEBHOOK_SECRET: ${WEBHOOK_SECRET}
(محفوظة أيضاً في ${STATE_FILE})

GitHub → Settings → Webhooks → Add webhook
  Payload URL : http://72.61.160.68:${HOOK_PORT}/deploy
  Content type: application/json
  Secret      : WEBHOOK_SECRET أعلاه
  Events      : Just the push event

تحديث يدوي في أي وقت:  redeploy

--- استيراد بيانات Lovable Cloud (اختياري) ---
على جهازك:
  pg_dump "\$SOURCE_DATABASE_URL" --no-owner --no-privileges --schema=public -Fc -f datahub.dump
  scp datahub.dump root@72.61.160.68:/root/
على الخادم:
  pg_restore --no-owner --no-privileges -d "${DATABASE_URL}" /root/datahub.dump

تشخيص خطأ 500:
  pm2 logs ${APP_NAME} --lines 100
======================================
EOF
