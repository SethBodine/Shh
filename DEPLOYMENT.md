# 🚀 Deployment Guide — Shh Secrets

Source: [https://github.com/SethBodine/Shh](https://github.com/SethBodine/Shh)

This guide deploys Shh using **Cloudflare's native GitHub integration** (OAuth), which is more secure than GitHub Actions because no Cloudflare API token is ever stored in GitHub.

---

## 📋 Prerequisites

- GitHub account
- Cloudflare account (free tier works)
- Discord server (optional — for activity notifications)

---

## 📁 Required File Structure

```
shh-secrets/
├── index.html
├── view.html
├── admin.html
├── swagger.html
├── swagger
├── openapi.yaml
├── _headers
├── _redirects
├── wrangler.toml
├── robots.txt
├── humans.txt
├── security.txt
├── README.md
├── DEPLOYMENT.md
└── functions/
    ├── _security.js
    ├── admin.js
    ├── api/
    │   └── [[path]].js
    └── view/
        └── [id].js
```

> **Important**: The `[[path]].js` and `[id].js` filenames use Cloudflare Pages bracket syntax for dynamic routing. Do not rename them.

---

## 🔧 Step-by-Step Deployment

### STEP 1 — Create GitHub Repository

```bash
# Option A — fork the repo on GitHub then clone your fork
git clone https://github.com/SethBodine/Shh shh-secrets && cd shh-secrets

# Option B — start fresh
mkdir shh-secrets && cd shh-secrets
git init
mkdir -p functions/api functions/view
```

Copy all project files into their correct paths (if Option B), then:

```bash
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/Shh.git
git push -u origin main
```

---

### STEP 2 — Create Cloudflare KV Namespace

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. **Workers & Pages** → **KV** → **Create a namespace**
3. Name: `shh-secrets`
4. **Copy the Namespace ID** — you'll need it in Step 3

---

### STEP 3 — Update `wrangler.toml`

Edit the file and replace the KV namespace ID:

```toml
name = "shh-secrets"
main = "functions/api/[[path]].js"
compatibility_date = "2024-01-01"

kv_namespaces = [
  { binding = "SECRETS_KV", id = "YOUR_ACTUAL_KV_NAMESPACE_ID" }
]

[triggers]
crons = ["0 */6 * * *"]
```

Commit and push the update:

```bash
git add wrangler.toml
git commit -m "Set KV namespace ID"
git push
```

---

### STEP 4 — Connect Cloudflare Pages to GitHub

1. Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Pages**
2. **Connect to Git** → **GitHub** → Authorise Cloudflare (one-time OAuth)
3. Select your `shh-secrets` repository
4. **Build configuration**:
   - Project name: `shh-secrets`
   - Production branch: `main`
   - Build command: *(leave empty)*
   - Build output directory: *(leave empty)*
5. **Save and Deploy** (first deploy may fail — that's fine, configure below first)

---

### STEP 5 — Set Environment Variables

In your Pages project → **Settings** → **Environment variables** → **Production**:

| Variable | Value | How to generate |
|---|---|---|
| `ADMIN_TOKEN` | 64-char hex string | `openssl rand -hex 32` |
| `DISCORD_WEBHOOK_URL` | `https://discord.com/api/webhooks/...` | Discord → Channel → Edit → Integrations → Webhooks |
| `RATE_LIMIT_CREATE` | `10` | Optional — creates per IP/hour |
| `RATE_LIMIT_VIEW` | `50` | Optional — views per IP/hour |
| `RATE_LIMIT_ADMIN` | `5` | Optional — admin actions per hour |

Click **Save**.

---

### STEP 6 — Bind KV Namespace

In **Settings** → **Functions** → **KV namespace bindings** → **Add binding**:

- **Variable name**: `SECRETS_KV` ← must be exactly this
- **KV namespace**: select `shh-secrets`

Click **Save**.

---

### STEP 7 — Create Discord Webhook (Optional)

1. Discord server → right-click channel → **Edit Channel** → **Integrations** → **Webhooks**
2. **New Webhook** → name it `Shh Monitor` → **Copy Webhook URL**
3. Paste into `DISCORD_WEBHOOK_URL` environment variable in Step 5

Test with:
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content":"Test from Shh Secrets 🤫"}'
```

---

### STEP 8 — Deploy

Trigger a fresh deployment:

**Option A** — Cloudflare Dashboard → **Deployments** → latest → **⋮** → **Retry deployment**

**Option B** — Push any change:
```bash
echo " " >> README.md
git add README.md && git commit -m "Trigger deploy" && git push
```

---

### STEP 9 — Verify

Once deployed (usually ~30 seconds), test:

```bash
# Health check
curl https://your-site.pages.dev/api/health | jq .

# Create a secret (basic test — use the web UI for real E2EE)
curl -X POST https://your-site.pages.dev/api/secret \
  -H "Content-Type: application/json" \
  -d '{"encryptedData":"dGVzdA","ttl":1}'

# Admin stats
curl -H "X-Admin-Token: YOUR_ADMIN_TOKEN" \
  https://your-site.pages.dev/api/admin/stats | jq .
```

Visit:
- `https://your-site.pages.dev` — create a secret
- `https://your-site.pages.dev/admin` — admin portal

---

## 🔄 Making Updates

```bash
# Edit files, then:
git add .
git commit -m "Description of changes"
git push
```

Cloudflare auto-deploys in ~30 seconds on every push to `main`.

---

## 🔒 Rotating the Admin Token

```bash
# Generate new token
openssl rand -hex 32
```

1. Cloudflare Dashboard → Pages → Settings → Environment variables
2. Edit `ADMIN_TOKEN` → paste new value → Save
3. Trigger a redeployment (Retry deployment or push a commit)

---

## 🌐 Custom Domain (Optional)

1. Pages project → **Custom domains** → **Set up a custom domain**
2. Enter your domain (e.g., `secrets.yourdomain.com`)
3. Follow the DNS instructions — SSL certificate provisions automatically (<5 min)

---

## ✅ Deployment Checklist

**Pre-deployment:**
- [ ] All files in correct paths
- [ ] KV namespace created and ID copied
- [ ] `wrangler.toml` updated with real KV namespace ID
- [ ] Code pushed to GitHub
- [ ] Cloudflare Pages connected via OAuth
- [ ] `ADMIN_TOKEN` set in environment variables
- [ ] `DISCORD_WEBHOOK_URL` set (optional)
- [ ] `SECRETS_KV` bound in Functions settings
- [ ] Cron trigger set (every 6 hours — `0 */6 * * *`)

**Post-deployment:**
- [ ] `/api/health` returns 200 with `kvBound: true`
- [ ] Can create a secret on the homepage
- [ ] Can view the secret via the generated link
- [ ] Secret destroyed after last view
- [ ] Discord notification received
- [ ] Admin portal accessible at `/admin` with token
- [ ] File upload works (if enabled)
- [ ] Passphrase-protected secret works end-to-end

---

## 🐛 Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `KV namespace not bound` (503) | Binding missing or wrong name | Check binding name is exactly `SECRETS_KV` |
| Unauthorized (admin, 401) | Wrong token or missing header | Verify `ADMIN_TOKEN` env var, check for spaces |
| Deployment fails | Build error | Check Pages → Deployments → deployment log |
| Files corrupt on download | Old version without binary fix | Ensure using v2.0.0+ |
| Passphrase fails | Case/space mismatch | Passphrase is case-sensitive, check for trailing spaces |
| Discord silent | Wrong URL or deleted webhook | Verify URL, test with `curl` |
| Secrets don't expire | KV TTL is the source of truth | KV handles expiry; cron is a belt-and-braces backup |

---

## 📊 Monitoring

| What to watch | Where |
|---|---|
| All activity | Discord channel |
| Deployment history | Cloudflare → Pages → Deployments |
| Worker logs (real-time) | Cloudflare → Pages → Functions → Logs |
| KV storage usage | Cloudflare → Workers & Pages → KV → `shh-secrets` |
| Admin audit trail | `/admin` portal — viewed secrets listed for 7 days |
