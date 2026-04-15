# 🤫 Shh — Secure One-Time Secret Sharing

[![Source on GitHub](https://img.shields.io/badge/source-GitHub-181717?logo=github)](https://github.com/SethBodine/Shh)

A zero-knowledge, end-to-end encrypted secret sharing service built on Cloudflare's edge network. Share sensitive information with self-destructing links that are encrypted entirely in the browser — the server never sees plaintext.

---

## ✨ Features

| Feature | Details |
|---|---|
| **E2EE — Zero Knowledge** | AES-256-GCM encryption happens in the browser. The server stores only ciphertext. |
| **Self-Destructing Links** | Secrets are deleted on the last allowed view or at TTL expiry. |
| **Configurable Views** | Set 1–10 allowed views per secret (default: 1). |
| **Optional Passphrase** | Add a second factor: key is PBKDF2-derived and AES-KW-wrapped, entirely client-side. |
| **File Attachments** | Attach up to 5 files (15 MB total) — encrypted client-side before upload. |
| **Customisable TTL** | 1, 3, 6, 12, or 24 hours. |
| **Expiry Countdown** | View page shows live time-to-expiry before revealing the secret. |
| **Themes & Dark Mode** | Six colour themes, auto dark/light based on time of day. |
| **Discord Logging** | Webhook notifications for all activity — zero content, metadata only. |
| **Admin Portal** | View active and recently-viewed secrets (IDs + metadata, never content). |
| **Rate Limiting** | Per-IP limits on create/view/admin, configurable via env vars. |
| **KV Pagination** | Admin operations correctly handle >1,000 secrets. |

---

## 🏗️ Architecture

```
Browser (creator)                 Cloudflare Edge               Browser (recipient)
─────────────────                 ───────────────               ───────────────────
Generate AES-256-GCM key
Optionally wrap key with          POST /api/secret
  PBKDF2(passphrase)      ──────► (ciphertext only)  ──────►   KV stores ciphertext
                                                      ◄──────   Returns secret ID

Build URL:                                                       Receives link
/view/{id}#{key or pp.salt.key}

                                  GET /api/secret/{id}/metadata  Check existence / TTL
                                  POST /api/secret/{id}/view     Fetch + delete ciphertext
                                                               ◄── Returns ciphertext
                                                                  Decrypt with key from #fragment
                                                                  (Passphrase → unwrap key first)
```

**The encryption key never leaves the browser** — it lives only in the URL fragment (`#`), which browsers never include in HTTP requests.

---

## 📁 Project Structure

```
shh-secrets/
├── index.html                  # Create secret page
├── view.html                   # View secret page (no-store cache)
├── admin.html                  # Admin portal
├── _routes.json                # Cloudflare Pages routing
├── _headers                    # HTTP security headers (CSP, cache control)
├── wrangler.toml               # Worker configuration
├── README.md
├── DEPLOYMENT.md
└── functions/
    ├── _security.js            # Shared security primitives
    ├── admin.js                # Serves admin.html
    ├── api/
    │   └── [[path]].js         # API catch-all worker
    └── view/
        └── [id].js             # Dynamic /view/{id} route → view.html
```

---

## 🔐 Security Design

### Encryption
- **Algorithm**: AES-256-GCM with a random 12-byte IV per operation
- **Key generation**: `crypto.subtle.generateKey` in the browser
- **Key transport**: URL fragment only — never in HTTP requests
- **Binary files**: Encrypted as raw bytes using the same key; decoded via ArrayBuffer (not text)

### Passphrase Protection
When a passphrase is set:
1. A random 16-byte salt is generated
2. A wrapping key is derived: `PBKDF2(passphrase, salt, 100000 iterations, SHA-256) → AES-KW-256`
3. The AES-GCM key is wrapped with `AES-KW`
4. URL fragment format: `pp.{saltBase64url}.{wrappedKeyBase64url}`
5. The passphrase is never stored or transmitted

The recipient enters the passphrase, the key is unwrapped client-side, and decryption proceeds. An incorrect passphrase causes AES-KW unwrap to throw — no information is leaked.

### Admin Token
- Compared using a constant-time algorithm that does not short-circuit on length difference, preventing timing-based token length leakage
- Stored as a Cloudflare environment secret

### HTTP Headers
All API responses carry security headers (CSP, HSTS, X-Frame-Options, etc.).  
Static HTML files get headers via the `_headers` file:
- `view.html`: `Cache-Control: no-store` + strict CSP + `Referrer-Policy: no-referrer`
- Other pages: `Cache-Control: no-cache` + CSP

> **Note**: The Tailwind CDN Play script requires `'unsafe-inline'` and `'unsafe-eval'` in the CSP. Switching to a pre-built Tailwind CSS file would remove this requirement and harden the CSP significantly.

---

## 🚀 Quick Deployment

See **DEPLOYMENT.md** for the full step-by-step guide.

### Summary
1. Fork/clone this repo and push to GitHub
2. Create a Cloudflare KV namespace named `shh-secrets`
3. Connect Cloudflare Pages to the GitHub repo (OAuth — no API tokens needed)
4. Set environment variables in Cloudflare Pages:
   - `ADMIN_TOKEN` — generate with `openssl rand -hex 32`
   - `DISCORD_WEBHOOK_URL` — optional but recommended
5. Bind the KV namespace as `SECRETS_KV` in Pages → Settings → Functions
6. Deploy

---

## 🎛️ Configuration

### Feature Flags (`functions/api/[[path]].js`)

```javascript
const FEATURES = {
  FILE_UPLOADS_ENABLED: true,         // Enable/disable file attachments
  MAX_FILE_SIZE:        10 * 1024 * 1024, // 10MB per file
  MAX_TEXT_SIZE:        1024,          // 1KB plaintext (encrypted ~4KB)
  MAX_TTL_HOURS:        24,
  MAX_VIEWS:            10,            // Maximum views settable by users
  DISCORD_WEBHOOK_ENABLED: true,
};

// Client-side limits (index.html)
// MAX_FILES       = 5          — max attachments per secret
// MAX_TOTAL_BYTES = 15 MB raw  — ~20 MB base64-encoded, safely under KV 25 MB value limit
```

### Environment Variables (Cloudflare Pages → Settings → Environment Variables)

| Variable | Required | Description |
|---|---|---|
| `ADMIN_TOKEN` | ✅ | Admin portal password. Generate: `openssl rand -hex 32` |
| `DISCORD_WEBHOOK_URL` | Optional | Discord channel webhook URL for activity notifications |
| `RATE_LIMIT_CREATE` | Optional | Secrets created per IP per hour (default: 10) |
| `RATE_LIMIT_VIEW` | Optional | Views per IP per hour (default: 50) |
| `RATE_LIMIT_ADMIN` | Optional | Admin actions per hour (default: 5) |
| `ENVIRONMENT` | Optional | Set to `development` to include stack traces in 500 errors |

---

## 📊 Admin Portal

Access at `/admin` using your `ADMIN_TOKEN`.

**What admins can see:**
- Active secret count and viewed-secret count (last 7 days)
- Per-secret: ID, created timestamp, expiry time, creating IP, view count / max views, passphrase-protected flag, file count
- Post-view: last-viewed timestamp, viewing IP

**What admins cannot see:**
- Secret content (zero-knowledge — ciphertext only stored)
- Encryption keys (never sent to server)

---

## 🔌 API Reference

All endpoints return JSON. CORS is enabled for all origins.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | None | Feature flags, version, config status |
| POST | `/api/secret` | None | Create a secret |
| GET | `/api/secret/{id}/metadata` | None | Check existence, TTL, views remaining |
| POST | `/api/secret/{id}/view` | None | Consume a view, return ciphertext |
| GET | `/api/admin/stats` | `X-Admin-Token` | List all secrets (metadata only) |
| DELETE | `/api/admin/secret/{id}` | `X-Admin-Token` | Delete a single secret |
| POST | `/api/admin/purge` | `X-Admin-Token` | Delete all active secrets |

### Create Secret — Request Body

```json
{
  "encryptedData": "base64url_aes256gcm_ciphertext",
  "ttl": 12,
  "maxViews": 1,
  "passphraseProtected": false,
  "files": [
    {
      "name": "document.pdf",
      "type": "application/pdf",
      "size": 1048576,
      "data": "base64url_aes256gcm_encrypted_binary"
    }
  ]
}
```

### Metadata — Response

```json
{
  "exists": true,
  "viewed": false,
  "hasFiles": true,
  "fileCount": 1,
  "viewsRemaining": 2,
  "maxViews": 3,
  "expiresAt": 1700000000000,
  "passphraseProtected": false
}
```

---

## 🐛 Troubleshooting

| Symptom | Fix |
|---|---|
| KV namespace not found | Verify binding name is exactly `SECRETS_KV` in Pages → Settings → Functions → KV namespace bindings |
| Admin login fails | Check `ADMIN_TOKEN` env var, no trailing spaces |
| Discord notifications silent | Verify webhook URL; test with `curl -X POST {url} -H "Content-Type: application/json" -d '{"content":"test"}'` |
| Files fail to download | Ensure browser supports Web Crypto API (all modern browsers do) |
| Secrets won't decrypt | URL must contain `#key` fragment; confirm the full link was shared |
| Passphrase decryption fails | Passphrase is case-sensitive; confirm no leading/trailing spaces |

---

## 📝 Changelog

### v3.2.0 (current)
- **File attachment UX**: per-file × delete buttons; styled picker button; duplicate-file deduplication
- **File upload hard limits**: max 5 files, 15 MB total (enforced client-side and pre-submit)
- **Bug fix**: `/admin` 308 redirect loop resolved — `ASSETS.fetch` no longer forwards the original request object
- **Bug fix**: file uploads over KV 25 MB limit now show a clear error instead of Internal Server Error

### v3.1.0
- **Archived expiry**: secrets that pass their TTL are moved to `expired:` archive rather than silently deleted
- **Proactive expiry scan**: `admin/stats` and request-time checks archive expired secrets without requiring cron
- **Admin portal**: expired secrets visible in dedicated archive tab

### v3.0.0
- **Multi-view secrets**: settable 1–10 views per secret
- **Passphrase protection**: PBKDF2 + AES-KW key wrapping, fully client-side
- **File upload progress bar**: shows per-file encryption progress
- **Expiry countdown**: live timer on view page before secret is consumed
- **KV pagination**: admin operations now correctly handle >1,000 secrets
- **`_headers` file**: CSP and cache-control headers for static HTML pages
- **Timing-safe token comparison**: fixed length-leak in admin token check
- **Dynamic API docs**: file upload section reflects live server feature flags
- **Admin dashboard**: shows viewed-secret count alongside active count
- **Clipboard fallback**: `execCommand` fallback for browsers that deny clipboard API

### v2.0.0
- End-to-end encryption (AES-256-GCM, client-side)
- Zero-knowledge architecture
- File uploads (binary-safe via ArrayBuffer)
- Fixed 500KB file size limit (chunked base64url encoder)
- Discord webhook logging

---

## 📝 License

MIT — free to use for any purpose.

## 🙏 Credits

Built with [Cloudflare Workers](https://workers.cloudflare.com/), [Cloudflare KV](https://developers.cloudflare.com/kv/), [Cloudflare Pages](https://pages.cloudflare.com/), and [Tailwind CSS](https://tailwindcss.com/).

Architecture and implementation by Claude (Anthropic). Inspired by [OneTimeSecret](https://onetimesecret.com/).

Source code: [https://github.com/SethBodine/Shh](https://github.com/SethBodine/Shh)
