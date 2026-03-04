#!/bin/bash
# Hetzner CX22 Setup Script – Allegro Ads Automate Backend
# Run as root on a fresh Ubuntu 24.04 server.
# Usage: curl -sL https://your-server/setup.sh | bash

set -euo pipefail

echo "=== Allegro Ads Automate – Server Setup ==="

# ── 1. System update ─────────────────────────────────────────────────────
apt-get update -q
apt-get upgrade -y -q

# ── 2. Firewall ──────────────────────────────────────────────────────────
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP (nginx)
ufw allow 443/tcp  # HTTPS (nginx)
ufw --force enable

# ── 3. Node.js 20 LTS ───────────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "Node: $(node -v), npm: $(npm -v)"

# ── 4. PostgreSQL 16 ─────────────────────────────────────────────────────
apt-get install -y postgresql postgresql-contrib

systemctl enable postgresql
systemctl start postgresql

# Create database and user
DB_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')
DB_NAME="allegro_ads_db"
DB_USER="allegro_ads"

sudo -u postgres psql <<SQL
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

echo ""
echo "=== DATABASE CREDENTIALS (SAVE THESE!) ==="
echo "DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
echo "============================================"
echo ""

# ── 5. Nginx ─────────────────────────────────────────────────────────────
apt-get install -y nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/allegro-ads-api <<'NGINX'
server {
    listen 80;
    server_name api.allegro-ads-automate.pl;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/allegro-ads-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# ── 6. PM2 (process manager) ─────────────────────────────────────────────
npm install -g pm2

# ── 7. Application user ───────────────────────────────────────────────────
useradd -m -s /bin/bash allegro || true
mkdir -p /home/allegro/app
chown allegro:allegro /home/allegro/app

# ── 8. PostgreSQL backup cron ────────────────────────────────────────────
mkdir -p /var/backups/postgres
cat > /etc/cron.d/postgres-backup <<CRON
0 3 * * * postgres pg_dump ${DB_NAME} | gzip > /var/backups/postgres/${DB_NAME}_\$(date +\%Y\%m\%d).sql.gz 2>&1
0 4 * * * find /var/backups/postgres -name "*.sql.gz" -mtime +30 -delete 2>&1
CRON

echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Next steps:"
echo "1. Clone repo: git clone https://github.com/norbertflas/marketplaceadsautomate /home/allegro/app"
echo "2. Copy .env:  cp /home/allegro/app/backend/.env.example /home/allegro/app/backend/.env"
echo "3. Edit .env with DB credentials and Stripe keys"
echo "4. Install deps: cd /home/allegro/app/backend && npm install"
echo "5. Run migration: npm run migrate"
echo "6. Start with PM2: pm2 start src/index.js --name allegro-ads-api"
echo "7. Save PM2: pm2 save && pm2 startup"
echo "8. SSL: certbot --nginx -d api.allegro-ads-automate.pl"
