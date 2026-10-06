# Deploying Zuno One on Google Cloud

One Compute Engine VM runs everything: the Node app, MongoDB, the marketing site,
and Caddy for automatic HTTPS. Sized for ~5 tenant companies.

**Cost:** ~$25–40/month (≈$18–20 VM after sustained-use discount, plus disk, IP,
egress). First ~3 months are covered by the $300 free-trial credit.

---

## 0. Before you start
- A domain, e.g. `zunoone.com`. Each company gets a subdomain (`acme.zunoone.com`),
  plus `admin.zunoone.com` for the super-admin portal and the apex for marketing.
- The `gcloud` CLI installed and logged in (`gcloud init`), or use the Cloud Console.

---

## 1. Reserve a static IP

```bash
gcloud compute addresses create zunoone-ip --region=europe-west1
gcloud compute addresses describe zunoone-ip --region=europe-west1 --format='value(address)'
```

Note the address — call it `SERVER_IP`.

---

## 2. Point DNS at the server

At your DNS provider, create **A records** for every hostname you'll serve:

| Host | Type | Value |
|---|---|---|
| `zunoone.com` | A | `SERVER_IP` |
| `www` | A | `SERVER_IP` |
| `admin` | A | `SERVER_IP` |
| `acme` | A | `SERVER_IP` |
| `company2` … `company5` | A | `SERVER_IP` |

*(A single `*` wildcard A record works too and saves adding one per company — but
then Caddy needs a DNS-challenge plugin. Explicit records keep it simple.)*

---

## 3. Create the VM

```bash
gcloud compute instances create zunoone \
  --zone=europe-west1-b \
  --machine-type=e2-standard-2 \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB --boot-disk-type=pd-balanced \
  --address=zunoone-ip \
  --tags=http-server,https-server
```

- `e2-medium` (4 GB) is the minimum; `e2-standard-2` (8 GB) is comfortable for 5
  WhatsApp sessions + MongoDB. Resize later with `gcloud compute instances set-machine-type`.

### Firewall (allow web + SSH only)

```bash
gcloud compute firewall-rules create allow-web \
  --allow=tcp:80,tcp:443 --target-tags=http-server,https-server --source-ranges=0.0.0.0/0
```

Port 3001 is **not** exposed — Caddy proxies to it on localhost.

---

## 4. Server setup

SSH in: `gcloud compute ssh zunoone --zone=europe-west1-b`

```bash
sudo apt update && sudo apt -y upgrade

# --- Node 20 LTS ---
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# --- MongoDB 7 ---
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod        # binds to 127.0.0.1 by default — leave it

# --- Caddy (auto HTTPS) ---
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# --- pm2 (keeps the app running / restarts on reboot) ---
sudo npm install -g pm2
```

---

## 5. Deploy the app

```bash
sudo mkdir -p /opt/zunoone && sudo chown $USER /opt/zunoone
cd /opt/zunoone
git clone <your-repo-url> .          # or scp the project up
npm ci --omit=dev

# persistent data lives under the app dir — sessions/ (Baileys auth) and uploads/
mkdir -p sessions uploads

cp .env .env.bak 2>/dev/null || true
nano .env
```

`.env` for production:

```
NODE_ENV=production
PORT=3001
ROOT_DOMAIN=zunoone.com
ADMIN_HOSTS=admin.zunoone.com
ALLOWED_ORIGINS=https://admin.zunoone.com,https://acme.zunoone.com
MONGODB_URI=mongodb://127.0.0.1:27017/zunoone
MAX_WA_SESSIONS=25
OPENAI_API_KEY=            # optional
SUPERADMIN_USER=owner
SUPERADMIN_PASS=<a strong password>
STRIPE_SECRET_KEY=         # optional
ENC_KEY=<base64 of 32 random bytes>   # message encryption at rest — REQUIRED in prod
```

Generate `ENC_KEY` once with `openssl rand -base64 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Keep it only here in `.env` (or a secret manager) — never commit it, never store it beside the Mongo/`sessions/` backups. Without it the app auto-creates `sessions/.enc-key`; with a stolen disk or backup, encrypted history is only as safe as that file. Losing the key makes existing encrypted WhatsApp history and website-chat threads unreadable, so back it up separately.

Start it:

```bash
node scripts/hash-passwords.js       # one-time, hashes any seeded passwords
pm2 start server.js --name zunoone
pm2 save
pm2 startup                          # run the command it prints (systemd hook)
```

---

## 6. Caddy config

`sudo nano /etc/caddy/Caddyfile`:

```
# marketing site (static folder from the repo)
zunoone.com, www.zunoone.com {
    root * /opt/zunoone/site
    file_server
    try_files {path} {path}.html /404.html
}

# app: super-admin portal + every company subdomain -> Node on :3001
admin.zunoone.com,
acme.zunoone.com,
company2.zunoone.com,
company3.zunoone.com,
company4.zunoone.com,
company5.zunoone.com {
    reverse_proxy localhost:3001
}
```

```bash
sudo systemctl reload caddy
```

Caddy gets a real certificate for each hostname automatically (HTTP-01). Adding
company #6 later = add its line, `sudo systemctl reload caddy`.

WebSockets (socket.io) pass through `reverse_proxy` with no extra config.

---

## 7. First run

1. Open `https://admin.zunoone.com` → log in as `owner` / your `SUPERADMIN_PASS`.
2. Add the 5 companies (slug = subdomain). Each gets an `admin` / `admin123` login —
   change it per company.
3. In each company's workspace (`https://<slug>.zunoone.com`), go to the WhatsApp
   channel and scan the QR from that company's phone.
4. `sessions/baileys-<slug>/` now holds the auth — **do not delete it** or that
   company re-scans.

---

## 8. Backups (MongoDB → Cloud Storage)

```bash
gsutil mb -l europe-west1 gs://zunoone-backups     # once

sudo tee /opt/zunoone/backup.sh >/dev/null <<'EOF'
#!/bin/bash
set -e
TS=$(date +%F-%H%M)
mongodump --uri="mongodb://127.0.0.1:27017/zunoone" --archive=/tmp/db-$TS.gz --gzip
gsutil cp /tmp/db-$TS.gz gs://zunoone-backups/
rm /tmp/db-$TS.gz
# also snapshot the Baileys auth folders
tar czf /tmp/sessions-$TS.tgz -C /opt/zunoone sessions
gsutil cp /tmp/sessions-$TS.tgz gs://zunoone-backups/
rm /tmp/sessions-$TS.tgz
EOF
sudo chmod +x /opt/zunoone/backup.sh
( crontab -l 2>/dev/null; echo "0 3 * * * /opt/zunoone/backup.sh" ) | crontab -
```

Set a 30-day lifecycle rule on the bucket so old backups delete themselves.

---

## 9. Updating the app

```bash
cd /opt/zunoone
git pull
npm ci --omit=dev
pm2 reload zunoone        # zero-downtime-ish restart; WhatsApp sessions reconnect
```

The marketing site rebuilds separately: `node site/build.js` (Caddy serves the
static folder directly, no restart needed).

---

## 10. Watch it

```bash
pm2 logs zunoone          # app logs
pm2 monit                  # CPU / memory per process
journalctl -u caddy -f     # TLS / proxy
free -m                    # if this gets tight, resize the VM up
```

Rule of thumb: each connected company ≈ 100–150 MB. If `free -m` shows under
~500 MB available, bump the machine type:

```bash
pm2 stop zunoone
sudo gcloud compute instances stop zunoone --zone=europe-west1-b
gcloud compute instances set-machine-type zunoone --zone=europe-west1-b --machine-type=e2-standard-4
gcloud compute instances start zunoone --zone=europe-west1-b
```

---

## Notes / gotchas

- **Do not** move to Cloud Run / App Engine — Baileys needs a long-lived process,
  a persistent filesystem for auth state, and outbound WebSockets. A plain VM is correct.
- One VM = one process. Before running a **second** app instance for scale, move the
  auth-token store out of memory (see `PRODUCTION.md` item 1) or sessions break on
  every deploy.
- Keep `sessions/` and `uploads/` on the boot disk (they're small) — or attach a
  separate persistent disk and symlink them if you want to resize independently.
- WhatsApp via Baileys is against WhatsApp's ToS; numbers can be banned. Budget for
  the official WhatsApp Business Cloud API if this becomes a real product.
