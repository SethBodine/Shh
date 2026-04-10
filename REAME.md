# 🤫 Shh - Secure Secrets

End-to-end encrypted secret sharing with self-destructing links.

## Features

- 🔐 **End-to-End Encryption**: Secrets encrypted in browser with AES-256-GCM
- 🔑 **Zero-Knowledge**: Server never sees plaintext, only encrypted data
- 🔥 **Self-Destructing**: Links expire after viewing or set time
- ⏱️ **Customizable TTL**: 1-24 hours
- 🎨 **6 Beautiful Themes**: Purple, Blue, Green, Orange, Pink, Teal
- 🌓 **Auto Dark Mode**: Based on local time (6PM-6AM)
- 📊 **Discord Monitoring**: Track usage and prevent abuse
- 🛡️ **Rate Limiting**: Configurable abuse protection
- 🔐 **Admin Portal**: Manage secrets (metadata only, cannot read content)

## Deployment

See DEPLOYMENT.md for complete setup instructions.

## Quick Start

1. Create Cloudflare KV namespace
2. Update `wrangler.toml` with KV namespace ID
3. Push to GitHub
4. Connect Cloudflare Pages to GitHub
5. Set environment variables in Cloudflare
6. Deploy!

## Environment Variables (Set in Cloudflare)

- `ADMIN_TOKEN` - Admin portal password (generate with: `openssl rand -hex 32`)
- `DISCORD_WEBHOOK_URL` - Discord webhook for notifications
- `RATE_LIMIT_CREATE` - Secrets per IP per hour (default: 10)
- `RATE_LIMIT_VIEW` - Views per IP per hour (default: 50)
- `RATE_LIMIT_ADMIN` - Admin actions per hour (default: 5)

## Security

- Client-side AES-256-GCM encryption
- Encryption keys never sent to server (URL fragments)
- Zero-knowledge architecture
- One-time use links
- No API tokens in GitHub

## License

MIT

## Credits

Built with Cloudflare Workers, Pages, and KV.
Encryption powered by Web Crypto API.
Created with Claude (Anthropic).