#!/usr/bin/env bash
# DATAHub — one-command VPS deployment and Lovable backup restore
# Usage: sudo bash deploy-all.sh [/absolute/path/export.backup]
set -Eeuo pipefail
umask 077

DOMAIN="${DOMAIN:-data.tg-kw.com}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-contact@tg-kw.com}"
APP_DIR="${APP_DIR:-/var/www/DATAHub}"
APP_NAME="datahub"
APP_PORT="3010"
BACKEND_DIR="/opt/datahub-backend"
BACKEND_PROJECT="datahub-backend"
BACKEND_PIN="cb9394246bc1832e9c18eb9a680d5f3c5854440f"
STATE_FILE="/root/.datahub-deploy.env"
BACKUP_FILE="${1:-}"
RESTORE_DB="datahub_restore"
LIVE_DB="datahub"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
on_error() {
  local line="$1"
  printf '\nDeployment stopped at line %s. Existing data was not intentionally deleted.\n' "$line" >&2
  command -v pm2 >/dev/null 2>&1 && pm2 logs "$APP_NAME" --lines 60 --nostream 2>/dev/null || true
  if [ -d "$BACKEND_DIR" ]; then
    docker compose --project-directory "$BACKEND_DIR" --project-name "$BACKEND_PROJECT" ps 2>/dev/null || true
  fi
}
trap 'on_error $LINENO' ERR

[ "${EUID}" -eq 0 ] || die "Run as root: sudo bash deploy-all.sh ..."
source /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "This script supports Ubuntu."
[ -z "$BACKUP_FILE" ] || [ -f "$BACKUP_FILE" ] || die "Backup not found: $BACKUP_FILE"
if [ -n "$BACKUP_FILE" ]; then
  file "$BACKUP_FILE" | grep -q "PostgreSQL custom database dump" || die "Expected the unzipped .backup file, not the .zip file."
  BACKUP_FILE="$(readlink -f "$BACKUP_FILE")"
fi

AVAILABLE_KB="$(df -Pk /opt | awk 'NR==2 {print $4}')"
if [ -n "$BACKUP_FILE" ]; then
  BACKUP_KB="$(( ($(stat -c %s "$BACKUP_FILE") + 1023) / 1024 ))"
  [ "$AVAILABLE_KB" -gt "$(( BACKUP_KB * 4 + 5 * 1024 * 1024 ))" ] || die "Not enough free disk space for a safe restore."
fi

say "Installing host requirements"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx openssl jq file rsync
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v pm2 >/dev/null 2>&1 || npm install -g pm2
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker nginx
docker compose version >/dev/null || die "Docker Compose v2 is required."

say "Locating the application checkout"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
  if [ "$SCRIPT_DIR" != "$APP_DIR" ]; then
    mkdir -p "$(dirname "$APP_DIR")"
    rsync -a --delete --exclude .git --exclude node_modules --exclude .output "$SCRIPT_DIR/" "$APP_DIR/"
  fi
elif [ ! -f "$APP_DIR/package.json" ]; then
  die "Run this script from the cloned DATAHub repository, or place it at $APP_DIR."
fi

say "Installing the pinned local backend bundle"
if [ ! -f "$BACKEND_DIR/docker-compose.yml" ] || [ ! -f "$BACKEND_DIR/.datahub-pin" ] || [ "$(cat "$BACKEND_DIR/.datahub-pin")" != "$BACKEND_PIN" ]; then
  STAGE_DIR="$(mktemp -d)"
  curl -fsSL "https://codeload.github.com/supabase/supabase/tar.gz/${BACKEND_PIN}" -o "$STAGE_DIR/backend.tar.gz"
  mkdir -p "$STAGE_DIR/docker"
  tar -xzf "$STAGE_DIR/backend.tar.gz" -C "$STAGE_DIR/docker" --strip-components=2 "supabase-${BACKEND_PIN}/docker"
  if [ -d "$BACKEND_DIR/volumes/db/data" ]; then
    cp -a "$BACKEND_DIR/volumes/db/data" "$STAGE_DIR/db-data"
  fi
  rm -rf "$BACKEND_DIR"
  mv "$STAGE_DIR/docker" "$BACKEND_DIR"
  if [ -d "$STAGE_DIR/db-data" ]; then
    rm -rf "$BACKEND_DIR/volumes/db/data"
    mv "$STAGE_DIR/db-data" "$BACKEND_DIR/volumes/db/data"
  fi
  printf '%s' "$BACKEND_PIN" > "$BACKEND_DIR/.datahub-pin"
  rm -rf "$STAGE_DIR"
fi

if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 32)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 48 | tr -d '\n')}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-$(openssl rand -hex 24)}"
SECRET_KEY_BASE="${SECRET_KEY_BASE:-$(openssl rand -base64 48 | tr -d '\n')}"
REALTIME_DB_ENC_KEY="${REALTIME_DB_ENC_KEY:-$(openssl rand -hex 8)}"
VAULT_ENC_KEY="${VAULT_ENC_KEY:-$(openssl rand -hex 16)}"
PG_META_CRYPTO_KEY="${PG_META_CRYPTO_KEY:-$(openssl rand -base64 32 | tr -d '\n')}"
LOGFLARE_PUBLIC_ACCESS_TOKEN="${LOGFLARE_PUBLIC_ACCESS_TOKEN:-$(openssl rand -hex 32)}"
LOGFLARE_PRIVATE_ACCESS_TOKEN="${LOGFLARE_PRIVATE_ACCESS_TOKEN:-$(openssl rand -hex 32)}"
S3_PROTOCOL_ACCESS_KEY_ID="${S3_PROTOCOL_ACCESS_KEY_ID:-$(openssl rand -hex 16)}"
S3_PROTOCOL_ACCESS_KEY_SECRET="${S3_PROTOCOL_ACCESS_KEY_SECRET:-$(openssl rand -hex 32)}"
POOLER_TENANT_ID="${POOLER_TENANT_ID:-$(openssl rand -hex 12)}"

make_jwt() {
  JWT_ROLE="$1" JWT_SECRET="$JWT_SECRET" node <<'NODE'
const crypto = require('crypto');
const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ role: process.env.JWT_ROLE, iss: 'supabase', iat: now, exp: now + 315360000 })}`;
process.stdout.write(`${body}.${crypto.createHmac('sha256', process.env.JWT_SECRET).update(body).digest('base64url')}`);
NODE
}
ANON_KEY="${ANON_KEY:-$(make_jwt anon)}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-$(make_jwt service_role)}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-$(openssl rand -hex 32)}"

cat > "$STATE_FILE" <<STATE
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}
SECRET_KEY_BASE=${SECRET_KEY_BASE}
REALTIME_DB_ENC_KEY=${REALTIME_DB_ENC_KEY}
VAULT_ENC_KEY=${VAULT_ENC_KEY}
PG_META_CRYPTO_KEY=${PG_META_CRYPTO_KEY}
LOGFLARE_PUBLIC_ACCESS_TOKEN=${LOGFLARE_PUBLIC_ACCESS_TOKEN}
LOGFLARE_PRIVATE_ACCESS_TOKEN=${LOGFLARE_PRIVATE_ACCESS_TOKEN}
S3_PROTOCOL_ACCESS_KEY_ID=${S3_PROTOCOL_ACCESS_KEY_ID}
S3_PROTOCOL_ACCESS_KEY_SECRET=${S3_PROTOCOL_ACCESS_KEY_SECRET}
POOLER_TENANT_ID=${POOLER_TENANT_ID}
WEBHOOK_SECRET=${WEBHOOK_SECRET}
STATE
chmod 600 "$STATE_FILE"

cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
set_env() {
  local key="$1" value="$2" file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
set_env COMPOSE_FILE "docker-compose.yml:docker-compose.pg17.yml:docker-compose.datahub.yml" "$BACKEND_DIR/.env"
set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD" "$BACKEND_DIR/.env"
set_env POSTGRES_DB "postgres" "$BACKEND_DIR/.env"
set_env JWT_SECRET "$JWT_SECRET" "$BACKEND_DIR/.env"
set_env ANON_KEY "$ANON_KEY" "$BACKEND_DIR/.env"
set_env SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY" "$BACKEND_DIR/.env"
set_env DASHBOARD_USERNAME "datahub" "$BACKEND_DIR/.env"
set_env DASHBOARD_PASSWORD "$DASHBOARD_PASSWORD" "$BACKEND_DIR/.env"
set_env SECRET_KEY_BASE "$SECRET_KEY_BASE" "$BACKEND_DIR/.env"
set_env REALTIME_DB_ENC_KEY "$REALTIME_DB_ENC_KEY" "$BACKEND_DIR/.env"
set_env VAULT_ENC_KEY "$VAULT_ENC_KEY" "$BACKEND_DIR/.env"
set_env PG_META_CRYPTO_KEY "$PG_META_CRYPTO_KEY" "$BACKEND_DIR/.env"
set_env LOGFLARE_PUBLIC_ACCESS_TOKEN "$LOGFLARE_PUBLIC_ACCESS_TOKEN" "$BACKEND_DIR/.env"
set_env LOGFLARE_PRIVATE_ACCESS_TOKEN "$LOGFLARE_PRIVATE_ACCESS_TOKEN" "$BACKEND_DIR/.env"
set_env S3_PROTOCOL_ACCESS_KEY_ID "$S3_PROTOCOL_ACCESS_KEY_ID" "$BACKEND_DIR/.env"
set_env S3_PROTOCOL_ACCESS_KEY_SECRET "$S3_PROTOCOL_ACCESS_KEY_SECRET" "$BACKEND_DIR/.env"
set_env POOLER_TENANT_ID "$POOLER_TENANT_ID" "$BACKEND_DIR/.env"
set_env SUPABASE_PUBLIC_URL "https://${DOMAIN}" "$BACKEND_DIR/.env"
set_env API_EXTERNAL_URL "https://${DOMAIN}/auth/v1" "$BACKEND_DIR/.env"
set_env SITE_URL "https://${DOMAIN}" "$BACKEND_DIR/.env"
set_env ADDITIONAL_REDIRECT_URLS "https://${DOMAIN}/**" "$BACKEND_DIR/.env"
set_env DISABLE_SIGNUP "true" "$BACKEND_DIR/.env"
set_env ENABLE_EMAIL_AUTOCONFIRM "false" "$BACKEND_DIR/.env"
set_env ENABLE_PHONE_SIGNUP "false" "$BACKEND_DIR/.env"
set_env API_GW_HTTP_PORT "8000" "$BACKEND_DIR/.env"
chmod 600 "$BACKEND_DIR/.env"

cat > "$BACKEND_DIR/docker-compose.datahub.yml" <<'YAML'
services:
  api-gw:
    ports: !override
      - "127.0.0.1:8000:8000/tcp"
  supavisor:
    ports: !override
      - "127.0.0.1:5432:5432/tcp"
      - "127.0.0.1:6543:6543/tcp"
YAML

compose() {
  docker compose --project-directory "$BACKEND_DIR" --project-name "$BACKEND_PROJECT" "$@"
}

say "Starting PostgreSQL 17"
compose up -d db
for _ in $(seq 1 90); do
  if compose exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 2
done
compose exec -T db pg_isready -U postgres -d postgres >/dev/null || die "PostgreSQL did not become ready."

if [ -n "$BACKUP_FILE" ]; then
  say "Validating and restoring $(basename "$BACKUP_FILE")"
  docker run --rm -v "$BACKUP_FILE:/backup/datahub.backup:ro" postgres:18 pg_restore -l /backup/datahub.backup >/dev/null

  if compose exec -T db psql -U postgres -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='${LIVE_DB}'" | grep -q 1; then
    SAFE_COPY="/root/datahub-before-restore-$(date -u +%Y%m%dT%H%M%SZ).backup"
    compose exec -T db pg_dump -U postgres -d "$LIVE_DB" -Fc > "$SAFE_COPY"
    [ -s "$SAFE_COPY" ] || die "Could not create the pre-restore safety backup."
  fi

  compose stop auth rest realtime storage meta functions studio supavisor api-gw 2>/dev/null || true
  compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${RESTORE_DB}','${LIVE_DB}') AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${RESTORE_DB};
CREATE DATABASE ${RESTORE_DB} TEMPLATE template0;
SQL
  compose exec -T db psql -U postgres -d "$RESTORE_DB" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE;"

  NETWORK_NAME="${BACKEND_PROJECT}_default"
  docker run --rm --network "$NETWORK_NAME" \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    -v "$BACKUP_FILE:/backup/datahub.backup:ro" \
    postgres:18 pg_restore -h db -U postgres -d "$RESTORE_DB" \
      --no-owner --exit-on-error --verbose /backup/datahub.backup

  COUNTS="$(compose exec -T db psql -U postgres -d "$RESTORE_DB" -At -F, -v ON_ERROR_STOP=1 -c \
    "SELECT (SELECT count(*) FROM auth.users),(SELECT count(*) FROM public.user_roles),(SELECT count(*) FROM public.countries),(SELECT count(*) FROM public.datasets),(SELECT count(*) FROM public.leads);")"
  [ -n "$COUNTS" ] || die "Restore validation returned no counts."
  IFS=, read -r AUTH_USERS ADMIN_ROLES COUNTRIES DATASETS LEADS <<< "$COUNTS"
  [ "$AUTH_USERS" -gt 0 ] || die "The restored backup contains no auth user."
  [ "$ADMIN_ROLES" -gt 0 ] || die "The restored backup contains no admin role."

  compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${RESTORE_DB}','${LIVE_DB}') AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${LIVE_DB};
ALTER DATABASE ${RESTORE_DB} RENAME TO ${LIVE_DB};
SQL
  set_env POSTGRES_DB "$LIVE_DB" "$BACKEND_DIR/.env"
  printf 'auth_users=%s\nadmin_roles=%s\ncountries=%s\ndatasets=%s\nleads=%s\n' \
    "$AUTH_USERS" "$ADMIN_ROLES" "$COUNTRIES" "$DATASETS" "$LEADS" > "$BACKEND_DIR/restore-counts.txt"
elif ! compose exec -T db psql -U postgres -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='${LIVE_DB}'" | grep -q 1; then
  die "First deployment requires the .backup path: bash deploy-all.sh /root/file.backup"
else
  set_env POSTGRES_DB "$LIVE_DB" "$BACKEND_DIR/.env"
fi

say "Starting local Auth and Data API services"
compose up -d
for _ in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:8000/auth/v1/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:8000/auth/v1/health >/dev/null || die "Local Auth health check failed."
curl -fsS -H "apikey: ${ANON_KEY}" http://127.0.0.1:8000/rest/v1/ >/dev/null || die "Local Data API health check failed."

say "Building and starting the Node application"
cat > "$APP_DIR/.env" <<APPENV
NODE_ENV=production
PORT=${APP_PORT}
VITE_SUPABASE_URL=https://${DOMAIN}
VITE_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
SUPABASE_URL=https://${DOMAIN}
SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
APPENV
chmod 600 "$APP_DIR/.env"
cd "$APP_DIR"
npm install
npm run build
ENTRY=""
for candidate in .output/server/index.mjs .output/server/index.js dist/server/index.mjs; do
  if [ -f "$candidate" ]; then ENTRY="$APP_DIR/$candidate"; break; fi
done
[ -n "$ENTRY" ] || die "Node build output was not found."
set -a; source "$APP_DIR/.env"; set +a
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
PORT="$APP_PORT" NODE_ENV=production pm2 start "$ENTRY" --name "$APP_NAME" --update-env
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash >/dev/null 2>&1 || true
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null || die "The Node application failed its direct health check."

say "Configuring Nginx and TLS"
cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    client_max_body_size 0;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    location = /deploy-webhook {
        proxy_pass http://127.0.0.1:8989/deploy;
        proxy_set_header X-Hub-Signature-256 \$http_x_hub_signature_256;
        proxy_set_header Content-Type \$content_type;
    }
    location ~ ^/(auth|rest|storage|realtime)/v1(?:/|\$) {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
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
ln -sfn "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t
systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect || \
  printf 'TLS was not issued. Confirm DNS points to this VPS, then rerun the script.\n' >&2
nginx -t && systemctl reload nginx

say "Installing safe redeploy and webhook commands"
cat > /usr/local/bin/redeploy <<REDEPLOY
#!/usr/bin/env bash
set -Eeuo pipefail
cd "${APP_DIR}"
git pull --ff-only
npm install
npm run build
set -a; source "${APP_DIR}/.env"; set +a
pm2 restart "${APP_NAME}" --update-env
curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null
pm2 save
echo "DATAHub redeployed successfully."
REDEPLOY
chmod 755 /usr/local/bin/redeploy

mkdir -p /opt/datahub-deploy-hook
cat > /opt/datahub-deploy-hook/server.cjs <<'HOOK'
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const secret = process.env.WEBHOOK_SECRET;
http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/deploy') return res.writeHead(404).end('not found');
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const supplied = String(req.headers['x-hub-signature-256'] || '');
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
    const a = Buffer.from(supplied), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.writeHead(401).end('bad signature');
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch { return res.writeHead(400).end('bad json'); }
    if (payload.ref !== 'refs/heads/main') return res.writeHead(200).end('ignored');
    res.writeHead(202).end('deploying');
    execFile('/usr/local/bin/redeploy', { timeout: 900000 }, (error, stdout, stderr) => {
      console.log(stdout || '', stderr || '', error || '');
    });
  });
}).listen(8989, '127.0.0.1', () => console.log('deploy hook listening locally'));
HOOK
pm2 delete datahub-deploy-hook >/dev/null 2>&1 || true
WEBHOOK_SECRET="$WEBHOOK_SECRET" pm2 start /opt/datahub-deploy-hook/server.cjs --name datahub-deploy-hook --update-env
pm2 save

say "Final end-to-end checks"
curl -fsS "https://${DOMAIN}/" >/dev/null || die "Public homepage check failed."
curl -fsS "https://${DOMAIN}/auth/v1/health" >/dev/null || die "Public Auth check failed."
curl -fsS -H "apikey: ${ANON_KEY}" "https://${DOMAIN}/rest/v1/" >/dev/null || die "Public Data API check failed."

printf '\nDeployment completed successfully.\n'
printf 'Site: https://%s\n' "$DOMAIN"
[ -f "$BACKEND_DIR/restore-counts.txt" ] && cat "$BACKEND_DIR/restore-counts.txt"
printf 'Secrets are stored at %s (root-only).\n' "$STATE_FILE"
printf 'For GitHub webhook, use: https://%s/deploy-webhook\n' "$DOMAIN"
printf 'Run future code updates with: redeploy\n'