# Zuno One CRM — production readiness

_Last verified: this pass. Server: `node server.js` on port 3001, MongoDB local._

## ✅ Verified working (functional)

Every feature was exercised via the UI and the API on the `acme` workspace.

| Area | Result |
|---|---|
| Login (bcrypt) | ✅ `admin` / `admin123` → 200, password auto-migrated to bcrypt on first login |
| Wrong password | ✅ 401 |
| Tenant isolation | ✅ a token for one workspace gets 403 on another (`auth.js`) |
| All 7 module views | ✅ render with **zero console errors** (inbox, contacts, broadcasts, workflows, reports, billing, settings) |
| WhatsApp inbox | ✅ 469 conversations load, ordered by recency, real numbers resolved |
| Open a conversation | ✅ 50 messages load with history, media refs, `_key`, timestamps |
| Agent attribution | ✅ outgoing messages carry the sending agent's name |
| Date separators | ✅ "Today / Yesterday / 3 Mar" chips in thread; date+time in list rows |
| Labels | ✅ create / list / apply / delete |
| Contact meta | ✅ status / assignee / notes upsert + read-back + socket broadcast |
| Automations | ✅ list + `/test` endpoint returns `{success:true}` |
| Broadcasts | ✅ list; runner starts on boot |
| Reports | ✅ live numbers computed from the conversation store (open 469, in 149, out 302, per-agent) |
| Settings save | ✅ routing + business hours persist |
| AI suggest with no key | ✅ **degrades gracefully** — `{success:false,error:"AI unavailable…"}`, no crash |
| Billing (manual) | ✅ plans load; plan change applies instantly (no Stripe key) |
| Real-time | ✅ socket.io connects (WebSocket, polling fallback), `presence` / `channel:*` events flow |
| Graceful shutdown | ✅ SIGINT/SIGTERM flush WhatsApp stores before exit |

## ✅ Hardening applied this pass

- **Passwords bcrypt-hashed** (`lib/passwords.js`, cost 12). Legacy plaintext rows verify once then re-hash automatically. Migration: `node scripts/hash-passwords.js` (already run — owner, a1, a2, a3, admin all hashed).
- **`helmet`** security headers (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, etc.). CSP left off — the app serves its own inline HTML/JS.
- **Rate limiting** on `/api/login` — 30 attempts / 15 min / IP.
- **Session TTL** — tokens expire after 7 days, sliding (`auth.js`).
- **Process resilience** — `unhandledRejection` / `uncaughtException` handlers so a Baileys socket blip doesn't take the server down. `SIGTERM` handled.
- **CORS** locks to `ALLOWED_ORIGINS` when `NODE_ENV=production` (permissive in dev).
- **Removed dead deps** — `whatsapp-web.js`, `qrcode-terminal` (no longer imported; dropped the Puppeteer/Chromium download).
- `.env` / `config.js` cleaned of stale WhatsApp-Web / Chrome keys.
- **Message encryption at rest** (`lib/crypto.js`) — AES-256-GCM. WhatsApp history (`sessions/store-<slug>.json`, whole-blob, per-workspace HKDF subkey `wa:<slug>`) and website-widget threads (`WebThread` message bodies + `lastText`) are sealed before they touch disk and opened only in memory for authenticated agents. Instagram / Messenger / Gmail are never stored (fetched live from Meta/Google). `Event` log stores facts + counts, never bodies. **Set `ENC_KEY`** (base64 of 32 bytes, or a passphrase) in production and keep it off the box — a process-manager secret / vault. Unset ⇒ a key is generated once at `sessions/.enc-key` (0600), fine for a single self-host. Old plaintext rows read fine and re-seal on their next write.

## ⛔ Must do before real production

These are **not code bugs** — they need decisions, keys, or infrastructure.

### Infrastructure
1. **Session store** — tokens live in memory. They vanish on restart and won't work across >1 instance. Move to Redis or a Mongo TTL collection. (`auth.js` is the only file to change.)
2. **Run under a supervisor** — pm2 / systemd / a container with restart policy. The error handlers keep the process alive for transient errors, not for everything.
3. **HTTPS + reverse proxy** — terminate TLS at nginx/Caddy, forward `Upgrade`/`Connection` headers for WebSockets, set `X-Forwarded-*`. `app.set('trust proxy', 1)` is already set.
4. **MongoDB** — enable auth, use a replica set, take backups. The current URI is an unauthenticated local instance.
5. **Wildcard DNS + TLS** for `*.yourdomain.com` (each tenant is a subdomain).
6. **Persistent volumes** for `sessions/` (Baileys auth + store JSON) and `uploads/` — losing `sessions/` forces every tenant to re-scan their QR.
7. **Log aggregation + error monitoring** (Sentry or similar). Right now errors only hit stdout.

### Channels
8. **WhatsApp** — this uses **Baileys (unofficial multi-device protocol)**. It works well but is against WhatsApp's ToS and numbers can be banned. For a real product, budget for the **official WhatsApp Business Cloud API**. Keep Baileys as the free tier if you accept the risk, and say so to customers.
9. **Instagram / Messenger** — need a Meta Developer app, Page tokens and a public HTTPS webhook (guides already built into the app and the `site/`). Not usable until a tenant completes that.
10. **Gmail** — needs a Google Cloud OAuth client; same story.

### Product / commercial
11. **Stripe** — code is complete (`stripe` installed, Checkout + customer portal + `/webhooks/stripe` handler for renewals / failed cards / cancellations). To go live: (a) set `STRIPE_SECRET_KEY` in `.env`; (b) in the Stripe dashboard add a webhook endpoint `https://admin.<domain>/webhooks/stripe` for events `checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`. Without a key, billing runs in manual/demo mode (plan changes apply instantly).
12. **AI** — set `OPENAI_API_KEY` (paid) or point the client at a self-hosted model. AI features are inert without it.
13. **Seat / contact limits** — `lib/plans.js` enforces on *add*, but existing over-limit workspaces aren't reconciled. Decide the downgrade behaviour.
14. **GDPR / DPA** — you're processing customer PII across borders. Data retention policy, a DPA, a deletion path, and a privacy policy are required. `ContactMeta` is the only PII you store; conversations are pulled live and not warehoused (good), but Baileys `sessions/store-*.json` does cache recent message text on disk — document and secure it.

### Frontend
15. **Tailwind via CDN** — `public/tenant.html` loads `cdn.tailwindcss.com` (a runtime JIT compiler; it warns in console and breaks offline). Build a static CSS file with the Tailwind CLI and self-host it.
16. **Input validation** — add a schema validator (zod/joi) on POST bodies. Several routes trust `req.body` shape.
17. **`multer` 1.x** — has advisories; move to `multer` 2.x or `busboy` and cap upload size / validate MIME server-side.

### Nice to have
18. CSRF isn't relevant (token in `Authorization` header, not cookies) — fine as-is.
19. Add `/metrics` (Prometheus) and structured request logging.
20. Automated tests — there are none. At minimum, smoke tests for auth + each router.

## How to run the checks again

```bash
node server.js                      # boot
node scripts/hash-passwords.js      # idempotent password migration
```
Then in the workspace (`http://acme.localhost:3001`, `admin` / `admin123`) open each module — console should be clean apart from the Tailwind-CDN warning.
