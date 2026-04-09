# 🚀 Complete Deployment Guide - Pure Cloudflare (No GitHub API)

## 📁 Required File Structure

```
shh-secrets/                          # Root directory (your repository)
│
├── index.html                        # Main page - create secrets
├── view.html                         # View secret page
├── admin.html                        # Admin portal page
├── _routes.json                      # Cloudflare Pages routing config
├── _redirects                        # URL redirect rules
├── wrangler.toml                     # Worker configuration
├── README.md                         # Documentation
│
└── functions/                        # Cloudflare Pages Functions directory
    └── api/                          # API route handler
        └── [[path]].js               # Catch-all API worker

# NO .github/ folder needed!
# NO GitHub Actions workflows!
# NO API tokens in GitHub!
```

---

## 🔐 Security-First Deployment (No GitHub API Integration)

This approach uses **Cloudflare's direct GitHub integration** (OAuth only) instead of GitHub Actions with API tokens. This is more secure because:

- ✅ No `CLOUDFLARE_API_TOKEN` stored in GitHub
- ✅ No GitHub Actions that could leak secrets
- ✅ All secrets stay in Cloudflare's vault
- ✅ OAuth is revocable anytime
- ✅ No third-party GitHub Actions code

---

## 🔧 Step-by-Step Deployment

### STEP 1: Create GitHub Repository

```bash
# Create a new directory
mkdir shh-secrets
cd shh-secrets

# Initialize git
git init

# Create the directory structure
mkdir -p functions/api
```

### STEP 2: Create All Files

Create each file with content from the artifacts:

**File Checklist:**
- [ ] `index.html` (from "Frontend - Main Application")
- [ ] `view.html` (from "Frontend - View Secret Page")  
- [ ] `admin.html` (from "Frontend - Admin Portal")
- [ ] `functions/api/[[path]].js` (from "Cloudflare Worker - API Backend")
- [ ] `wrangler.toml` (from "Pure Cloudflare Deployment" artifact)
- [ ] `_routes.json` 
- [ ] `_redirects`
- [ ] `README.md`

**_routes.json:**
```json
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": []
}
```

**_redirects:**
```
/view/:id  /view.html  200
/admin     /admin.html 200
```

### STEP 3: Create Cloudflare KV Namespace

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Workers & Pages** in sidebar
3. Click **KV** tab
4. Click **Create a namespace**
5. Name it: **`shh-secure-secrets`**
6. Click **Add**
7. **COPY THE NAMESPACE ID** 
   - It looks like: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`
   - You'll need this in the next step!

### STEP 4: Update wrangler.toml

Edit `wrangler.toml` in your code and paste your real KV namespace ID:

```toml
kv_namespaces = [
  { binding = "SECRETS_KV", id = "PASTE_YOUR_ACTUAL_KV_ID_HERE" }
]
```

**Example:**
```toml
kv_namespaces = [
  { binding = "SECRETS_KV", id = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" }
]
```

### STEP 5: Push to GitHub

```bash
git add .
git commit -m "Initial commit with Shh Secrets"
git branch -M main

# Create repo on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/shh-secrets.git
git push -u origin main
```

### STEP 6: Connect Cloudflare Pages to GitHub

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Workers & Pages**
3. Click **Create application**
4. Select **Pages** tab
5. Click **Connect to Git**
6. Click **GitHub** (you'll be prompted to authorize Cloudflare)
7. **Authorize Cloudflare Pages** (one-time OAuth - no API tokens!)
8. Select your **shh-secrets** repository
9. Click **Begin setup**

**Build Configuration:**
- **Project name**: `shh-secrets`
- **Production branch**: `main`
- **Build command**: (leave empty)
- **Build output directory**: (leave empty)

10. Click **Save and Deploy**

Cloudflare will deploy for the first time (may fail - that's OK, we need to configure next)

### STEP 7: Configure Environment Variables

1. In Cloudflare Dashboard, go to **Workers & Pages**
2. Click your **shh-secrets** project
3. Click **Settings** tab
4. Click **Environment variables**
5. Select **Production** environment
6. Click **Add variables**

Add these variables:

| Variable Name | Value | How to Generate |
|--------------|-------|-----------------|
| `ADMIN_TOKEN` | `<64-char hex string>` | `openssl rand -hex 32` |
| `DISCORD_WEBHOOK_URL` | `https://discord.com/api/webhooks/...` | Discord Server → Channel Settings → Integrations → Webhooks |
| `RATE_LIMIT_CREATE` | `10` | Optional - secrets created per IP/hour |
| `RATE_LIMIT_VIEW` | `50` | Optional - secrets viewed per IP/hour |
| `RATE_LIMIT_ADMIN` | `5` | Optional - admin actions per hour |

7. Click **Save**

### STEP 8: Bind KV Namespace

Still in **Settings**:

1. Scroll down to **Functions** section
2. Find **KV namespace bindings**
3. Click **Add binding**

Configure:
- **Variable name**: `SECRETS_KV` (must be exactly this!)
- **KV namespace**: Select `shh-secure-secrets` from dropdown

4. Click **Save**

### STEP 9: Set Up Cron Trigger

Still in **Settings**:

1. Scroll to **Triggers** section
2. Find **Cron Triggers**
3. Click **Add Cron Trigger**
4. Enter: `0 */6 * * *` (runs every 6 hours)
5. Click **Add Trigger**

### STEP 10: Create Discord Webhook (Optional)

1. Open your Discord server
2. Right-click the channel where you want notifications
3. Click **Edit Channel** → **Integrations** → **Webhooks**
4. Click **New Webhook**
5. Name it: `Shh Secrets Monitor`
6. Click **Copy Webhook URL**
7. Go back to Cloudflare → Settings → Environment variables
8. Find `DISCORD_WEBHOOK_URL` and paste the URL
9. Click **Save**

### STEP 11: Trigger Deployment

1. Go to **Deployments** tab in your Cloudflare Pages project
2. Find the latest deployment
3. Click **⋮** (three dots) → **Retry deployment**

Or simply push a change:
```bash
# Make a small change
echo "# Shh - Secure Secrets" > README.md
git add README.md
git commit -m "Add README"
git push origin main
```

Cloudflare automatically detects the push and deploys!

### STEP 12: Verify Deployment

1. Wait for deployment to complete (~30 seconds)
2. Click the **Visit site** link in Cloudflare Dashboard
3. Test creating a secret
4. Check Discord for notification
5. Test viewing the secret
6. Test admin portal with your `ADMIN_TOKEN`

---

## 🎯 How Auto-Deployment Works

```
┌──────────────┐
│  Developer   │
│  git push    │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  GitHub Repo     │
│  (code only!)    │
└──────┬───────────┘
       │
       │ Webhook notification (automatic)
       ▼
┌─────────────────────────────┐
│  Cloudflare Pages           │
│  1. Detects git push        │
│  2. Pulls code via OAuth    │
│  3. Reads wrangler.toml     │
│  4. Loads environment vars  │
│  5. Binds KV namespace      │
│  6. Deploys to edge         │
└─────────────────────────────┘
```

**No GitHub Actions!**
**No API tokens in GitHub!**
**All secrets in Cloudflare!**

---

## 🔒 Security Comparison

### ❌ Old Way (GitHub Actions - RISKY)
```
GitHub Secrets:
├── CLOUDFLARE_API_TOKEN (full account access!)
├── CLOUDFLARE_ACCOUNT_ID
└── Risk: Exposed in Actions logs, third-party actions

GitHub Actions Workflow:
├── Runs on GitHub's infrastructure
├── Could leak tokens in logs
└── Third-party actions could steal credentials
```

### ✅ New Way (Cloudflare Direct - SECURE)
```
GitHub Repository:
├── Code only (public anyway)
├── wrangler.toml (with KV ID - not sensitive)
└── Zero secrets!

Cloudflare Pages:
├── All secrets stored securely
├── KV namespace bound per-project
├── OAuth authorization (revocable)
└── No API tokens anywhere!
```

---

## 🔄 Making Updates

### Update Code
```bash
# Edit your files
git add .
git commit -m "Update feature X"
git push origin main
```

Cloudflare auto-deploys in ~30 seconds!

### Update Environment Variables
1. Cloudflare Dashboard → Pages → Your Project
2. Settings → Environment variables
3. Click **Edit** on the variable
4. Change value → **Save**
5. Go to Deployments → Retry latest deployment

### Update Rate Limits
1. Cloudflare Dashboard → Settings → Environment variables
2. Edit `RATE_LIMIT_CREATE`, `RATE_LIMIT_VIEW`, or `RATE_LIMIT_ADMIN`
3. Save → Redeploy

### Rotate Admin Token
```bash
# Generate new token
openssl rand -hex 32

# Copy the output, then:
# 1. Cloudflare Dashboard → Settings → Environment variables
# 2. Edit ADMIN_TOKEN → Paste new value → Save
# 3. Redeploy
```

---

## 🚨 Revoking Cloudflare Access

If needed, revoke Cloudflare's GitHub access:

1. GitHub → Settings → Applications → Authorized OAuth Apps
2. Find **Cloudflare Pages**
3. Click **Revoke**

To reconnect: Just go through Step 6 again!

---

## ✅ Deployment Checklist

**Pre-Deployment:**
- [ ] Created GitHub repository
- [ ] Created all required files
- [ ] Created KV namespace `shh-secure-secrets`
- [ ] Updated `wrangler.toml` with real KV namespace ID
- [ ] Pushed code to GitHub
- [ ] Connected Cloudflare Pages to GitHub (OAuth)
- [ ] Set all environment variables in Cloudflare
- [ ] Bound KV namespace in Cloudflare
- [ ] Created cron trigger
- [ ] Created Discord webhook (optional)

**Post-Deployment:**
- [ ] Site loads successfully
- [ ] Can create secrets
- [ ] Can view secrets
- [ ] Encryption/decryption works
- [ ] Discord notifications arrive
- [ ] Admin portal accessible with token
- [ ] Rate limiting works (test by exceeding limits)
- [ ] Secrets auto-expire after TTL

---

## 📊 Monitoring

### Deployment Status
- **Cloudflare Dashboard** → Pages → Deployments

### Application Logs
- **Cloudflare Dashboard** → Pages → Functions → Logs

### KV Storage Usage
- **Cloudflare Dashboard** → KV → shh-secure-secrets

### Discord Notifications
- Check your Discord channel for:
  - Secret created
  - Secret viewed
  - Rate limit exceeded
  - Admin purge

---

## 🎓 Troubleshooting

### "KV namespace not found"
- Verify binding name is exactly `SECRETS_KV`
- Check KV namespace ID in `wrangler.toml` is correct
- Ensure binding is set in Pages Functions settings

### "Unauthorized" in admin portal
- Verify `ADMIN_TOKEN` is set in environment variables
- Check for typos (must be exact match)
- Try regenerating and setting a new token

### Discord notifications not working
- Verify webhook URL is correct
- Check webhook hasn't been deleted in Discord
- Test webhook with curl:
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content":"Test from Shh Secrets"}'
```

### Deployment fails
- Check deployment logs in Cloudflare Dashboard
- Verify `wrangler.toml` syntax is correct
- Ensure KV namespace ID is valid

### Secrets won't decrypt
- Check URL has `#` fragment with encryption key
- Verify browser supports Web Crypto API (all modern browsers do)
- Check browser console for errors

---

## 🎉 You're Done!

Your Shh Secrets app is now deployed with:
- ✅ End-to-end encryption
- ✅ Zero-knowledge architecture  
- ✅ No GitHub API tokens
- ✅ Auto-deployment on git push
- ✅ All secrets in Cloudflare
- ✅ Configurable rate limits
- ✅ Discord monitoring
- ✅ Secure admin portal

**Push to GitHub, Cloudflare deploys automatically! 🚀**

## 📁 Required File Structure

```
secureshare/                          # Root directory (your repository)
│
├── index.html                        # Main page - create secrets
├── view.html                         # View secret page
├── admin.html                        # Admin portal page
├── _routes.json                      # Cloudflare Pages routing config
├── _redirects                        # URL redirect rules
├── wrangler.toml                     # Worker configuration
├── README.md                         # Documentation
│
├── functions/                        # Cloudflare Pages Functions directory
│   └── api/                          # API route handler
│       └── [[path]].js               # Catch-all API worker
│
└── .github/                          # GitHub Actions (optional but recommended)
    └── workflows/
        └── deploy.yml                # Auto-deployment workflow
```

---

## 📄 File Contents & Paths

### 1. `/index.html`
**Path:** `secureshare/index.html`

This is your main landing page from the "Frontend - Main Application" artifact.
- Users create secrets here
- Contains theme selector and dark mode toggle
- Auto-detects file upload feature status

### 2. `/view.html`
**Path:** `secureshare/view.html`

This is the secret viewing page from the "Frontend - View Secret Page" artifact.
- Shows warning before viewing
- Displays secret content one time
- Handles file downloads

### 3. `/admin.html`
**Path:** `secureshare/admin.html`

This is the admin portal from the "Frontend - Admin Portal" artifact.
- Token-based authentication
- View stats and purge secrets
- No access to secret content

### 4. `/functions/api/[[path]].js`
**Path:** `secureshare/functions/api/[[path]].js`

This is the Cloudflare Worker API backend from the "Cloudflare Worker - API Backend" artifact.
- Handles all API requests
- Manages KV storage
- Contains feature flags
- **IMPORTANT:** The `[[path]].js` filename is special syntax for Cloudflare Pages - it creates a catch-all route

### 5. `/_routes.json`
**Path:** `secureshare/_routes.json`

```json
{
  "version": 1,
  "include": [
    "/api/*"
  ],
  "exclude": []
}
```

This tells Cloudflare Pages which routes should be handled by Workers.

### 6. `/_redirects`
**Path:** `secureshare/_redirects`

```
/view/:id  /view.html  200
/admin     /admin.html 200
```

This creates clean URLs:
- `/view/abc-123` → serves `view.html`
- `/admin` → serves `admin.html`

### 7. `/wrangler.toml`
**Path:** `secureshare/wrangler.toml`

```toml
name = "secureshare"
main = "functions/api/[[path]].js"
compatibility_date = "2024-01-01"

kv_namespaces = [
  { binding = "SECRETS_KV", id = "YOUR_KV_NAMESPACE_ID_HERE", preview_id = "YOUR_PREVIEW_KV_ID_HERE" }
]

[triggers]
crons = ["0 */6 * * *"]
```

**Replace:**
- `YOUR_KV_NAMESPACE_ID_HERE` - with your production KV namespace ID
- `YOUR_PREVIEW_KV_ID_HERE` - with your preview KV namespace ID (optional)

### 8. `/.github/workflows/deploy.yml`
**Path:** `secureshare/.github/workflows/deploy.yml`

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: secureshare
          directory: .
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

---

## 🔧 Step-by-Step Deployment

### STEP 1: Create GitHub Repository

```bash
# Create a new directory
mkdir secureshare
cd secureshare

# Initialize git
git init

# Create the directory structure
mkdir -p functions/api
mkdir -p .github/workflows
```

### STEP 2: Create All Files

Create each file in the exact paths shown above and paste the content from the corresponding artifacts.

**File Checklist:**
- [ ] `index.html` (from "Frontend - Main Application" artifact)
- [ ] `view.html` (from "Frontend - View Secret Page" artifact)
- [ ] `admin.html` (from "Frontend - Admin Portal" artifact)
- [ ] `functions/api/[[path]].js` (from "Cloudflare Worker - API Backend" artifact)
- [ ] `_routes.json` (JSON config above)
- [ ] `_redirects` (redirect rules above)
- [ ] `wrangler.toml` (config above - **update KV IDs**)
- [ ] `.github/workflows/deploy.yml` (GitHub Actions workflow above)
- [ ] `README.md` (from "README.md - Complete Setup Guide" artifact)

### STEP 3: Create Cloudflare KV Namespace

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Workers & Pages** in sidebar
3. Click **KV** tab
4. Click **Create a namespace**
5. Name it: **`shh-secure-secrets`** (or any name you prefer)
6. Click **Add**
7. **Copy the Namespace ID** (looks like: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`)
8. Optionally create a preview namespace for testing (name it `shh-secure-secrets-preview`)

**IMPORTANT SECURITY NOTE:** 
- The KV namespace name itself doesn't provide security
- Security comes from proper binding configuration and access controls
- The Worker validates the KV binding at runtime
- Rate limiting prevents abuse (10 creates/hour, 50 views/hour per IP)

### STEP 4: Update wrangler.toml

Edit `wrangler.toml` and replace:
```toml
kv_namespaces = [
  { binding = "SECRETS_KV", id = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" }
]
```

### STEP 5: Create Cloudflare API Token

1. Go to Cloudflare Dashboard
2. Click your profile icon → **My Profile**
3. Click **API Tokens** tab
4. Click **Create Token**
5. Use **Edit Cloudflare Workers** template
6. Click **Continue to summary**
7. Click **Create Token**
8. **Copy the token** (you won't see it again!)

### STEP 6: Get Cloudflare Account ID

1. In Cloudflare Dashboard, go to **Workers & Pages**
2. Your Account ID is shown in the right sidebar
3. Or find it in the URL: `dash.cloudflare.com/<ACCOUNT_ID>/workers`

### STEP 7: Set GitHub Secrets

1. Push your code to GitHub first:
```bash
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/secureshare.git
git push -u origin main
```

2. Go to your GitHub repository
3. Click **Settings** tab
4. Click **Secrets and variables** → **Actions**
5. Click **New repository secret**
6. Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `CLOUDFLARE_API_TOKEN` | Your Cloudflare API token from Step 5 |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID from Step 6 |

### STEP 8: Create Cloudflare Pages Project

**Option A: Via Dashboard (Recommended)**

1. Go to Cloudflare Dashboard → **Workers & Pages**
2. Click **Create application** → **Pages** → **Connect to Git**
3. Select your GitHub repository
4. Configure:
   - **Production branch:** `main`
   - **Build command:** (leave empty)
   - **Build output directory:** (leave empty)
5. Click **Save and Deploy**

**Option B: Via GitHub Actions (Automatic)**

The GitHub Action will create the project automatically on first push.

### STEP 9: Configure Environment Variables in Cloudflare

1. Go to your Pages project in Cloudflare Dashboard
2. Click **Settings** tab
3. Click **Environment variables**
4. Click **Add variables**
5. Add these (for **Production** environment):

| Variable Name | Value | Type |
|---------------|-------|------|
| `ADMIN_TOKEN` | Generate: `openssl rand -hex 32` | Secret text |
| `DISCORD_WEBHOOK_URL` | Your Discord webhook URL | Secret text |

6. **Bind KV Namespace:**
   - Click **Functions** (in Settings)
   - Scroll to **KV namespace bindings**
   - Click **Add binding**
   - Variable name: `SECRETS_KV` (must be exactly this)
   - KV namespace: Select your `shh-secure-secrets` namespace
   - Click **Save**

**SECURITY:** The Worker code validates this binding at runtime and will refuse to start if it's misconfigured.

### STEP 10: Set Up Cron Trigger

1. In Cloudflare Dashboard, go to **Workers & Pages**
2. Click your **secureshare** project
3. Click **Settings** tab
4. Scroll to **Triggers** → **Cron Triggers**
5. Click **Add Cron Trigger**
6. Enter: `0 */6 * * *` (runs every 6 hours)
7. Click **Add Trigger**

### STEP 11: Create Discord Webhook (Optional)

1. Open your Discord server
2. Right-click the channel where you want notifications
3. Click **Edit Channel** → **Integrations** → **Webhooks**
4. Click **New Webhook**
5. Name it: `SecureShare Monitor`
6. Copy the **Webhook URL**
7. Add it to Cloudflare environment variables as `DISCORD_WEBHOOK_URL`

### STEP 12: Deploy!

```bash
# Make any final changes
git add .
git commit -m "Ready for deployment"
git push origin main
```

GitHub Actions will automatically deploy to Cloudflare Pages!

### STEP 13: Verify Deployment

1. Go to **Actions** tab in GitHub - watch the deployment
2. Once complete, visit your site:
   - `https://secureshare.pages.dev` (or your custom domain)
3. Test creating a secret
4. Check Discord for notification
5. Test viewing the secret
6. Test admin portal with your `ADMIN_TOKEN`

---

## 🎯 Custom Domain (Optional)

1. In Cloudflare Pages project, click **Custom domains**
2. Click **Set up a custom domain**
3. Enter your domain (e.g., `secrets.yourdomain.com`)
4. Follow DNS instructions
5. Wait for SSL certificate (usually < 5 minutes)

---

## ✅ Deployment Checklist

- [ ] Created all 9 files in correct paths
- [ ] Created KV namespace "SECRETS"
- [ ] Updated `wrangler.toml` with KV namespace ID
- [ ] Created Cloudflare API token
- [ ] Found Cloudflare Account ID
- [ ] Set GitHub secrets (API token & Account ID)
- [ ] Pushed code to GitHub
- [ ] Created Cloudflare Pages project
- [ ] Set environment variables in Cloudflare
- [ ] Bound KV namespace to Pages project
- [ ] Created cron trigger (every 6 hours)
- [ ] Created Discord webhook
- [ ] Tested secret creation
- [ ] Tested secret viewing
- [ ] Tested admin portal
- [ ] Verified Discord notifications

---

## 🐛 Troubleshooting

### "KV namespace not found"
- Verify binding name is exactly `SECRETS_KV`
- Check namespace ID in `wrangler.toml` matches Cloudflare
- Ensure binding is set in Pages Functions settings

### "Unauthorized" in admin portal
- Verify `ADMIN_TOKEN` is set in environment variables
- Check for typos or extra spaces
- Try regenerating the token

### Discord notifications not working
- Verify webhook URL is correct
- Check webhook hasn't been deleted in Discord
- Ensure `DISCORD_WEBHOOK_ENABLED: true` in worker code

### "Cannot read properties of undefined"
- Clear browser cache
- Check browser console for errors
- Verify all JavaScript files loaded correctly

### Deployment fails
- Check GitHub Actions logs
- Verify Cloudflare API token has correct permissions
- Ensure Account ID is correct

---

## 🔄 Updating Your Deployment

To update the app after making changes:

```bash
git add .
git commit -m "Description of changes"
git push origin main
```

GitHub Actions will automatically redeploy!

---

## 📊 Monitoring Your App

**Check these regularly:**

1. **Discord Channel** - All activity logs
2. **Cloudflare Analytics** - Usage stats
3. **KV Metrics** - Storage usage
4. **GitHub Actions** - Deployment history

---

## 🎉 You're Done!

Your SecureShare app is now live! Share the URL and start sharing secrets securely! 🔒✨