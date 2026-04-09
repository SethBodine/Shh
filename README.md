# 🔒 SecureShare - One-Time Secret Sharing

A secure, self-destructing secret sharing service built on Cloudflare's edge network. Share sensitive information with confidence using one-time links that automatically expire.

## ✨ Features

- **🔥 Self-Destructing Links** - Secrets are permanently deleted after viewing or expiration
- **⏱️ Customizable TTL** - Set expiration from 1 to 24 hours
- **📝 Text Sharing** - Share up to 1KB of text per secret
- **📎 File Uploads** - Optional file attachments up to 10MB (feature flag)
- **🔐 Secure** - No server-side logs of secret content
- **⚡ Edge Performance** - Powered by Cloudflare's global network
- **📊 Discord Logging** - Track usage and prevent abuse
- **🛡️ Admin Portal** - Manage and purge secrets (no content visibility)
- **🚀 Auto-Deploy** - GitHub integration for automatic deployment

## 🏗️ Architecture

- **Frontend**: Static HTML/CSS/JS hosted on Cloudflare Pages
- **Backend**: Cloudflare Workers with KV storage
- **Storage**: Cloudflare KV with automatic TTL expiration
- **Monitoring**: Discord webhooks for activity logging
- **Deployment**: GitHub Actions auto-deploy to Cloudflare Pages

## 📋 Prerequisites

- GitHub account
- Cloudflare account (free tier works)
- Discord server (optional, for notifications)

## 🚀 Quick Start

### 1. Fork/Clone This Repository

```bash
git clone https://github.com/yourusername/secureshare.git
cd secureshare
```

### 2. Create Cloudflare KV Namespace

1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **Workers & Pages** > **KV**
3. Click **Create a namespace**
4. Name it: `SECRETS`
5. Copy the **Namespace ID**

### 3. Configure Project

Create/update `wrangler.toml`:

```toml
name = "secureshare"
main = "functions/api/[[path]].js"
compatibility_date = "2024-01-01"

kv_namespaces = [
  { binding = "SECRETS_KV", id = "YOUR_KV_NAMESPACE_ID_HERE" }
]

[triggers]
crons = ["0 */6 * * *"]
```

### 4. Set Up GitHub Secrets

Go to your repository **Settings** > **Secrets and variables** > **Actions**

Add these secrets:
- `CLOUDFLARE_API_TOKEN` - Create at Cloudflare Dashboard > My Profile > API Tokens
  - Use "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID` - Find in Workers & Pages overview

### 5. Configure Environment Variables

In Cloudflare Dashboard:
1. Go to **Workers & Pages** > Your Pages project
2. Navigate to **Settings** > **Environment variables**
3. Add:
   - `ADMIN_TOKEN` - Generate: `openssl rand -hex 32`
   - `DISCORD_WEBHOOK_URL` - (Optional) Your Discord webhook URL
   - Bind `SECRETS_KV` to your KV namespace

### 6. Deploy

Push to your `main` branch:

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

GitHub Actions will automatically deploy your site!

### 7. Access Your Site

Your site will be available at:
- `https://secureshare.pages.dev` (or your custom domain)

## 🎛️ Configuration

### Feature Flags

In `functions/api/[[path]].js`:

```javascript
const FEATURES = {
  FILE_UPLOADS_ENABLED: false,  // Set to true to enable file uploads
  MAX_FILE_SIZE: 10 * 1024 * 1024,  // 10MB
  MAX_TEXT_SIZE: 1024,  // 1KB
  MAX_TTL_HOURS: 24,
  DISCORD_WEBHOOK_ENABLED: true,
};
```

**Note**: These flags cannot be modified from the browser for security.

### Discord Notifications

Create a Discord webhook:
1. Discord Server > Settings > Integrations > Webhooks
2. Create webhook for your channel
3. Copy webhook URL
4. Add as `DISCORD_WEBHOOK_URL` environment variable

Notifications include:
- Source IP address
- TTL setting
- Message length
- Attached filenames (no content)
- Timestamp

## 🔐 Admin Portal

Access at: `https://your-site.pages.dev/admin`

**Authentication**: Use the `ADMIN_TOKEN` you set in environment variables

**Features**:
- View total active secrets count
- See secret IDs (content is never visible)
- Purge all secrets
- Real-time statistics

**Security Note**: Admins can only see metadata, never secret content.

## 🛡️ Security Features

1. **One-Time Use**: Links are destroyed immediately after viewing
2. **Automatic Expiration**: TTL-based cleanup via KV and cron jobs
3. **No Content Logging**: Secret content is never logged or visible to admins
4. **Abuse Monitoring**: Discord notifications track all activity
5. **IP Tracking**: Source IPs logged for abuse prevention
6. **Secure Storage**: Encrypted at rest in Cloudflare KV
7. **Admin Protection**: Token-based authentication for admin portal

## 📊 Monitoring & Maintenance

### Scheduled Cleanup

Cron job runs every 6 hours to clean up expired secrets:
- Set in `wrangler.toml`: `crons = ["0 */6 * * *"]`
- Also configured in Cloudflare Dashboard > Workers > Triggers

### Discord Monitoring

Watch for:
- Unusual IP patterns
- High-frequency usage
- Large file uploads (if enabled)
- Excessive secret creation

### KV Storage

Monitor in Cloudflare Dashboard:
- Workers & Pages > KV > SECRETS
- Check storage usage
- Review key count

## 🔧 Troubleshooting

### Secrets not expiring
- Check KV TTL is set correctly
- Verify cron trigger is active
- Review worker logs

### Discord notifications not working
- Verify webhook URL is correct
- Check webhook hasn't been deleted
- Ensure `DISCORD_WEBHOOK_ENABLED: true`

### Admin portal login fails
- Confirm `ADMIN_TOKEN` is set in environment variables
- Check token matches exactly (no spaces)
- Try regenerating token

### Deployment fails
- Verify GitHub secrets are set correctly
- Check Cloudflare API token permissions
- Review GitHub Actions logs

## 📁 Project Structure

```
secureshare/
├── index.html              # Main page (create secret)
├── view.html               # View secret page
├── admin.html              # Admin portal
├── _routes.json            # Cloudflare Pages routes
├── _redirects              # URL redirects
├── wrangler.toml           # Worker configuration
├── functions/
│   └── api/
│       └── [[path]].js     # API worker backend
└── .github/
    └── workflows/
        └── deploy.yml      # Auto-deployment workflow
```

## 🚦 API Endpoints

### Create Secret
```
POST /api/secret
Body: { text, ttl, files }
Response: { id, url, expiresIn }
```

### Check Secret Metadata
```
GET /api/secret/:id/metadata
Response: { exists, viewed, hasFiles, fileCount }
```

### View Secret (One-Time)
```
POST /api/secret/:id/view
Response: { text, files }
```

### Admin Stats
```
GET /api/admin/stats
Headers: { X-Admin-Token }
Response: { totalSecrets, secrets }
```

### Admin Purge
```
POST /api/admin/purge
Headers: { X-Admin-Token }
Response: { purged }
```

## 🎯 Roadmap

- [ ] End-to-end encryption (client-side)
- [ ] Passphrase protection
- [ ] Custom expiration times (minutes, days)
- [ ] Read receipts
- [ ] API key generation for programmatic access
- [ ] Rate limiting per IP
- [ ] Custom domains support
- [ ] Multiple file format support
- [ ] Secret burning before viewing

## 📝 License

MIT License - feel free to use for any purpose

## 🤝 Contributing

Pull requests welcome! Please ensure:
- Code follows existing patterns
- Security features are maintained
- Discord logging works
- Admin portal remains secure

## ⚠️ Important Notes

1. **Never commit secrets**: Don't commit `ADMIN_TOKEN` or Discord webhook URLs
2. **Rotate tokens**: Change admin token regularly
3. **Monitor usage**: Check Discord notifications for abuse
4. **Backup strategy**: KV data is ephemeral by design (no backups needed)
5. **File uploads**: Disabled by default, enable only if needed
6. **Compliance**: Ensure usage complies with your local regulations

## 📞 Support

- Issues: GitHub Issues
- Discussions: GitHub Discussions
- Security: Please report vulnerabilities privately

## 🙏 Credits

Built with:
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [Cloudflare Pages](https://pages.cloudflare.com/)
- [Tailwind CSS](https://tailwindcss.com/)

Inspired by [OneTimeSecret](https://onetimesecret.com/)

**Special Thanks:**
- 🤖 Initial architecture and implementation by Claude (Anthropic) - because sometimes the best code comes from a good conversation about secure secret sharing and edge computing vibes
- 💜 Purple gradient aesthetic courtesy of Claude's impeccable taste in modern web design

---

**Made with ❤️ and deployed on the edge** ✨
