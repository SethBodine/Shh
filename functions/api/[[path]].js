// ===================================
// CLOUDFLARE WORKER - API BACKEND
// File: functions/api/[[path]].js
// ===================================

import {
  applySecurityHeaders,
  getCORSHeaders,
  validateAdminToken,
  isValidUUID,
  isValidTTL,
  validateEncryptedData,
  validateFileMetadata,
  getClientIP,
  generateSecretKey,
  generateRateLimitKey,
  sanitizeError,
} from '../_security.js';

// ===================================
// FEATURE FLAGS
// ===================================
const FEATURES = {
  FILE_UPLOADS_ENABLED: true,
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  MAX_TEXT_SIZE: 1024,
  MAX_TTL_HOURS: 24,
  MAX_VIEWS: 10,
  DISCORD_WEBHOOK_ENABLED: true,
};

// KV key prefixes
// secret:  — active, not yet viewed to completion
// viewed:  — consumed by reaching maxViews (7-day audit log)
// expired: — TTL lapsed without being fully viewed (30-day audit log)

function getRateLimits(env) {
  return {
    CREATE_SECRET_PER_IP_PER_HOUR: parseInt(env.RATE_LIMIT_CREATE || '10'),
    VIEW_SECRET_PER_IP_PER_HOUR:   parseInt(env.RATE_LIMIT_VIEW   || '50'),
    ADMIN_ACTION_PER_HOUR:         parseInt(env.RATE_LIMIT_ADMIN  || '5'),
  };
}

// Paginate through all KV keys with a prefix
async function listAllKVKeys(kv, prefix) {
  const keys = [];
  let cursor, listComplete = false;
  do {
    const result = await kv.list({ prefix, ...(cursor ? { cursor } : {}) });
    keys.push(...result.keys);
    listComplete = result.list_complete;
    cursor = result.cursor;
  } while (!listComplete);
  return keys;
}

async function sendDiscordNotification(env, clientIP, data) {
  if (!FEATURES.DISCORD_WEBHOOK_ENABLED || !env.DISCORD_WEBHOOK_URL) return;
  const fields = [
    { name: 'Source IP',  value: clientIP || 'unknown',              inline: true },
    { name: 'TTL',        value: `${data.ttl || 0} hours`,            inline: true },
    { name: 'Size',       value: `${data.messageLength || 0} bytes`,  inline: true },
  ];
  if (data.maxViews && data.maxViews > 1)
    fields.push({ name: 'Max Views',  value: String(data.maxViews),  inline: true });
  if (data.viewCount !== undefined)
    fields.push({ name: 'View Count', value: String(data.viewCount), inline: true });
  if (data.files && data.files.length > 0)
    fields.push({ name: 'Files', value: data.files.join(', '), inline: false });
  try {
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ title: data.title || 'Secret Activity', color: data.color || 3447003, fields, timestamp: new Date().toISOString() }] }),
    });
  } catch (err) { console.error('Discord notification failed:', err); }
}

async function checkRateLimit(env, action, clientIP, limit) {
  const key     = generateRateLimitKey(action, clientIP);
  const current = await env.SECRETS_KV.get(key);
  const count   = current ? parseInt(current) : 0;
  if (count >= limit) return false;
  await env.SECRETS_KV.put(key, (count + 1).toString(), { expirationTtl: 3600 });
  return true;
}

// Build a summary object for admin stats from a raw KV record
function buildActiveSummary(key, p) {
  const mv = p.maxViews || 1, vc = p.viewCount || 0;
  return {
    id: key.replace('secret:', ''), status: 'active',
    createdAt: p.createdAt, expiresAt: p.createdAt + (p.ttl || 24) * 3600000,
    clientIP: p.clientIP, viewCount: vc, maxViews: mv, viewsRemaining: mv - vc,
    viewerLog: p.viewerLog || [], hasFiles: !!(p.files && p.files.length),
    fileCount: p.files?.length || 0, passphraseProtected: !!p.passphraseProtected,
  };
}
function buildViewedSummary(key, p) {
  return {
    id: key.replace('viewed:', ''), status: 'viewed',
    createdAt: p.createdAt, viewedAt: p.viewedAt, clientIP: p.clientIP,
    viewedByIP: p.viewedByIP, viewCount: p.viewCount || 1, maxViews: p.maxViews || 1,
    viewerLog: p.viewerLog || [], hasFiles: !!(p.files && p.files.length),
    fileCount: p.files?.length || 0, passphraseProtected: !!p.passphraseProtected,
  };
}
function buildExpiredSummary(key, p) {
  return {
    id: key.replace('expired:', ''), status: 'expired',
    createdAt: p.createdAt, expiredAt: p.expiredAt, clientIP: p.clientIP,
    viewCount: p.viewCount || 0, maxViews: p.maxViews || 1,
    viewerLog: p.viewerLog || [], hasFiles: !!(p.files && p.files.length),
    fileCount: p.files?.length || 0, passphraseProtected: !!p.passphraseProtected,
    adminExpired: !!p.adminExpired,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url  = new URL(request.url);
  const path = url.pathname.replace('/api/', '');

  if (!env.SECRETS_KV) {
    return new Response(JSON.stringify({ error: 'Service configuration error - KV namespace not bound', hint: 'Check Cloudflare Pages Settings > Functions > KV namespace bindings' }), {
      status: 503, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...getCORSHeaders() }),
    });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: applySecurityHeaders(getCORSHeaders()) });
  }

  const clientIP    = getClientIP(request);
  const RATE_LIMITS = getRateLimits(env);
  const corsHeaders = getCORSHeaders();

  try {

    // ── HEALTH CHECK ──────────────────────────────────────────────────────────
    if (request.method === 'GET' && path === 'health') {
      return new Response(JSON.stringify({
        status: 'ok', version: '3.1.0', timestamp: new Date().toISOString(),
        features: {
          fileUploads: FEATURES.FILE_UPLOADS_ENABLED, maxFileSize: FEATURES.MAX_FILE_SIZE,
          maxTextSize: FEATURES.MAX_TEXT_SIZE, maxTTL: FEATURES.MAX_TTL_HOURS,
          maxViews: FEATURES.MAX_VIEWS, e2ee: true, zeroKnowledge: true, passphraseProtection: true,
        },
        config: { kvBound: !!env.SECRETS_KV, adminTokenSet: !!env.ADMIN_TOKEN, discordWebhookSet: !!env.DISCORD_WEBHOOK_URL },
        rateLimits: RATE_LIMITS,
      }), { headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
    }

    // ── CREATE SECRET ─────────────────────────────────────────────────────────
    if (request.method === 'POST' && path === 'secret') {
      if (!await checkRateLimit(env, 'create', clientIP, RATE_LIMITS.CREATE_SECRET_PER_IP_PER_HOUR)) {
        await sendDiscordNotification(env, clientIP, { title: '🚨 Rate Limit Exceeded - Create', color: 15158332 });
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.', retryAfter: 3600 }), {
          status: 429, headers: applySecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': '3600', ...corsHeaders }),
        });
      }
      let data;
      try { data = await request.json(); } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
          status: 400, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }),
        });
      }
      const { encryptedData, ttl = 24, files = [], maxViews = 1, passphraseProtected = false } = data;
      if (!isValidTTL(ttl, FEATURES.MAX_TTL_HOURS))
        return new Response(JSON.stringify({ error: `TTL must be between 1 and ${FEATURES.MAX_TTL_HOURS} hours` }), { status: 400, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const maxViewsInt = parseInt(maxViews);
      if (isNaN(maxViewsInt) || maxViewsInt < 1 || maxViewsInt > FEATURES.MAX_VIEWS)
        return new Response(JSON.stringify({ error: `maxViews must be between 1 and ${FEATURES.MAX_VIEWS}` }), { status: 400, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const validation = validateEncryptedData(encryptedData, FEATURES.MAX_TEXT_SIZE * 4);
      if (!validation.valid)
        return new Response(JSON.stringify({ error: validation.error }), { status: 400, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      if (files.length > 0) {
        if (!FEATURES.FILE_UPLOADS_ENABLED)
          return new Response(JSON.stringify({ error: 'File uploads are not enabled' }), { status: 403, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
        for (const file of files) {
          const fv = validateFileMetadata(file, FEATURES.MAX_FILE_SIZE);
          if (!fv.valid) return new Response(JSON.stringify({ error: fv.error }), { status: 400, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
        }
      }
      const secretId = crypto.randomUUID();
      await env.SECRETS_KV.put(generateSecretKey(secretId), JSON.stringify({
        encryptedData, files, ttl, maxViews: maxViewsInt, viewCount: 0,
        passphraseProtected: !!passphraseProtected, createdAt: Date.now(),
        clientIP, userAgent: request.headers.get('User-Agent') || 'unknown',
      }), { expirationTtl: ttl * 3600 });
      await sendDiscordNotification(env, clientIP, { title: '🔒 Secret Created (E2EE)', color: 3066993, ttl, maxViews: maxViewsInt, messageLength: encryptedData.length, files: files.map(f => f.name) });
      return new Response(JSON.stringify({ id: secretId, expiresIn: ttl, maxViews: maxViewsInt }), {
        status: 201, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }),
      });
    }

    // ── GET SECRET METADATA ───────────────────────────────────────────────────
    if (request.method === 'GET' && path.startsWith('secret/') && path.endsWith('/metadata')) {
      const secretId = path.split('/')[1];
      if (!isValidUUID(secretId))
        return new Response(JSON.stringify({ error: 'Invalid secret ID format' }), { status: 400, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const rawData = await env.SECRETS_KV.get(generateSecretKey(secretId));
      if (!rawData)
        return new Response(JSON.stringify({ error: 'Secret not found or already consumed' }), { status: 404, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const parsed = JSON.parse(rawData);
      const maxViews = parsed.maxViews || 1, viewCount = parsed.viewCount || 0;
      return new Response(JSON.stringify({
        exists: true, viewed: viewCount >= maxViews,
        hasFiles: !!(parsed.files && parsed.files.length), fileCount: parsed.files?.length || 0,
        viewsRemaining: maxViews - viewCount, maxViews,
        expiresAt: parsed.createdAt + (parsed.ttl || 24) * 3600 * 1000,
        passphraseProtected: !!parsed.passphraseProtected,
      }), { headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
    }

    // ── VIEW SECRET ───────────────────────────────────────────────────────────
    if (request.method === 'POST' && path.startsWith('secret/') && path.endsWith('/view')) {
      if (!await checkRateLimit(env, 'view', clientIP, RATE_LIMITS.VIEW_SECRET_PER_IP_PER_HOUR)) {
        await sendDiscordNotification(env, clientIP, { title: '🚨 Rate Limit Exceeded - View', color: 15158332 });
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.', retryAfter: 3600 }), {
          status: 429, headers: applySecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': '3600', ...corsHeaders }),
        });
      }
      const secretId = path.split('/')[1];
      if (!isValidUUID(secretId))
        return new Response(JSON.stringify({ error: 'Invalid secret ID format' }), { status: 400, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const kvKey  = generateSecretKey(secretId);
      const rawData = await env.SECRETS_KV.get(kvKey);
      if (!rawData)
        return new Response(JSON.stringify({ error: 'Secret not found or already consumed' }), { status: 404, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const parsed      = JSON.parse(rawData);
      const maxViews    = parsed.maxViews   || 1;
      const newViewCount = (parsed.viewCount || 0) + 1;
      const isLastView  = newViewCount >= maxViews;
      const viewerLog   = [...(parsed.viewerLog || []), { viewNumber: newViewCount, viewedAt: Date.now(), viewedByIP: clientIP }];
      if (isLastView) {
        await env.SECRETS_KV.put(`viewed:${secretId}`, JSON.stringify({ ...parsed, viewCount: newViewCount, viewerLog, viewedAt: Date.now(), viewedByIP: clientIP }), { expirationTtl: 7 * 24 * 3600 });
        await env.SECRETS_KV.delete(kvKey);
      } else {
        const remainingTtl = Math.max(1, Math.ceil(((parsed.createdAt + (parsed.ttl || 24) * 3600000) - Date.now()) / 1000));
        await env.SECRETS_KV.put(kvKey, JSON.stringify({ ...parsed, viewCount: newViewCount, viewerLog }), { expirationTtl: remainingTtl });
      }
      await sendDiscordNotification(env, clientIP, { title: isLastView ? '👁️ Secret Viewed — Final (E2EE)' : `👁️ Secret Viewed (${newViewCount}/${maxViews}) (E2EE)`, color: 15158332, messageLength: parsed.encryptedData?.length || 0, viewCount: newViewCount, maxViews, files: parsed.files?.map(f => f.name) || [] });
      return new Response(JSON.stringify({ encryptedData: parsed.encryptedData, files: parsed.files, viewsRemaining: maxViews - newViewCount, isLastView }), {
        headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }),
      });
    }

    // ── ADMIN: GET STATS ──────────────────────────────────────────────────────
    if (request.method === 'GET' && path === 'admin/stats') {
      if (!validateAdminToken(request, env))
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });

      const [activeKeys, viewedKeys, expiredKeys] = await Promise.all([
        listAllKVKeys(env.SECRETS_KV, 'secret:'),
        listAllKVKeys(env.SECRETS_KV, 'viewed:'),
        listAllKVKeys(env.SECRETS_KV, 'expired:'),
      ]);

      const readAll = async (keys, builder, prefix) => {
        const results = [];
        for (const key of keys) {
          const raw = await env.SECRETS_KV.get(key.name);
          if (!raw) continue;
          try { results.push(builder(key.name, JSON.parse(raw))); } catch (e) { console.error('Parse error:', key.name, e); }
        }
        return results;
      };

      const [activeSecrets, viewedSecrets, expiredSecrets] = await Promise.all([
        readAll(activeKeys,  buildActiveSummary),
        readAll(viewedKeys,  buildViewedSummary),
        readAll(expiredKeys, buildExpiredSummary),
      ]);

      activeSecrets.sort((a, b)  => b.createdAt - a.createdAt);
      viewedSecrets.sort((a, b)  => (b.viewedAt  || b.createdAt) - (a.viewedAt  || a.createdAt));
      expiredSecrets.sort((a, b) => (b.expiredAt || b.createdAt) - (a.expiredAt || a.createdAt));

      return new Response(JSON.stringify({
        totalSecrets: activeKeys.length,
        totalViewed:  viewedKeys.length,
        totalExpired: expiredKeys.length,
        activeSecrets, viewedSecrets, expiredSecrets,
      }), { headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
    }

    // ── ADMIN: FORCE-EXPIRE A SINGLE ACTIVE SECRET ────────────────────────────
    if (request.method === 'POST' && path.startsWith('admin/secret/') && path.endsWith('/expire')) {
      if (!validateAdminToken(request, env))
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const secretId = path.split('/')[2];
      if (!isValidUUID(secretId))
        return new Response(JSON.stringify({ error: 'Invalid secret ID format' }), { status: 400, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const kvKey  = generateSecretKey(secretId);
      const rawData = await env.SECRETS_KV.get(kvKey);
      if (!rawData)
        return new Response(JSON.stringify({ error: 'Secret not found' }), { status: 404, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const parsed = JSON.parse(rawData);
      await env.SECRETS_KV.put(`expired:${secretId}`, JSON.stringify({ ...parsed, expiredAt: Date.now(), adminExpired: true }), { expirationTtl: 30 * 24 * 3600 });
      await env.SECRETS_KV.delete(kvKey);
      await sendDiscordNotification(env, clientIP, { title: '⏱️ Admin Force-Expired Secret', color: 15844367 });
      return new Response(JSON.stringify({ expired: secretId }), { headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
    }

    // ── ADMIN: DELETE SINGLE SECRET (active, viewed, or expired) ─────────────
    if (request.method === 'DELETE' && path.startsWith('admin/secret/')) {
      if (!validateAdminToken(request, env))
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const secretId = path.split('/')[2];
      if (!isValidUUID(secretId))
        return new Response(JSON.stringify({ error: 'Invalid secret ID format' }), { status: 400, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      // Delete whichever prefix holds this ID
      await Promise.all([
        env.SECRETS_KV.delete(generateSecretKey(secretId)),
        env.SECRETS_KV.delete(`viewed:${secretId}`),
        env.SECRETS_KV.delete(`expired:${secretId}`),
      ]);
      await sendDiscordNotification(env, clientIP, { title: '🗑️ Admin Delete Secret', color: 15844367 });
      return new Response(JSON.stringify({ deleted: secretId }), { headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
    }

    // ── ADMIN: PURGE ALL ACTIVE SECRETS ──────────────────────────────────────
    if (request.method === 'POST' && path === 'admin/purge') {
      if (!validateAdminToken(request, env))
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      if (!await checkRateLimit(env, 'admin', clientIP, RATE_LIMITS.ADMIN_ACTION_PER_HOUR))
        return new Response(JSON.stringify({ error: 'Rate limit exceeded for admin actions', retryAfter: 3600 }), { status: 429, headers: applySecurityHeaders({ 'Content-Type': 'application/json', 'Retry-After': '3600', ...corsHeaders }) });
      const keys = await listAllKVKeys(env.SECRETS_KV, 'secret:');
      await Promise.all(keys.map(k => env.SECRETS_KV.delete(k.name)));
      await sendDiscordNotification(env, clientIP, { title: '🗑️ Admin Purge All Active', color: 10038562 });
      return new Response(JSON.stringify({ purged: keys.length }), { headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
    }

    // ── ADMIN: DELETE ALL ARCHIVED (viewed + expired) ─────────────────────────
    if (request.method === 'POST' && path === 'admin/purge-archived') {
      if (!validateAdminToken(request, env))
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const [viewedKeys, expiredKeys] = await Promise.all([
        listAllKVKeys(env.SECRETS_KV, 'viewed:'),
        listAllKVKeys(env.SECRETS_KV, 'expired:'),
      ]);
      await Promise.all([...viewedKeys, ...expiredKeys].map(k => env.SECRETS_KV.delete(k.name)));
      await sendDiscordNotification(env, clientIP, { title: '🗑️ Admin Purge All Archived', color: 10038562 });
      return new Response(JSON.stringify({ purged: viewedKeys.length + expiredKeys.length }), { headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
    }

    // ── ADMIN: DELETE ALL VIEWED ONLY ─────────────────────────────────────────
    if (request.method === 'POST' && path === 'admin/purge-viewed') {
      if (!validateAdminToken(request, env))
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const keys = await listAllKVKeys(env.SECRETS_KV, 'viewed:');
      await Promise.all(keys.map(k => env.SECRETS_KV.delete(k.name)));
      return new Response(JSON.stringify({ purged: keys.length }), { headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
    }

    // ── ADMIN: DELETE ALL EXPIRED ONLY ────────────────────────────────────────
    if (request.method === 'POST' && path === 'admin/purge-expired') {
      if (!validateAdminToken(request, env))
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
      const keys = await listAllKVKeys(env.SECRETS_KV, 'expired:');
      await Promise.all(keys.map(k => env.SECRETS_KV.delete(k.name)));
      return new Response(JSON.stringify({ purged: keys.length }), { headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }) });
    }

    return new Response(JSON.stringify({ error: 'Not Found', path }), {
      status: 404, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }),
    });

  } catch (error) {
    console.error('Unhandled error:', error);
    const isDevelopment = env.ENVIRONMENT === 'development';
    return new Response(JSON.stringify(sanitizeError(error, isDevelopment)), {
      status: 500, headers: applySecurityHeaders({ 'Content-Type': 'application/json', ...corsHeaders }),
    });
  }
}

// ===================================
// SCHEDULED CLEANUP — archives expired secrets instead of silently deleting them
// ===================================
export async function scheduled(event, env, ctx) {
  console.log('Running scheduled cleanup...');
  if (!env.SECRETS_KV) { console.error('KV not available'); return; }

  const keys = await listAllKVKeys(env.SECRETS_KV, 'secret:');
  let archived = 0, cleaned = 0;

  for (const key of keys) {
    const raw = await env.SECRETS_KV.get(key.name);
    if (!raw) { cleaned++; continue; }
    try {
      const parsed = JSON.parse(raw);
      const ttlMs  = (parsed.ttl || 24) * 3600000;
      if (Date.now() > parsed.createdAt + ttlMs) {
        const secretId = key.name.replace('secret:', '');
        // Archive to expired: prefix for 30 days so admins can review
        await env.SECRETS_KV.put(
          `expired:${secretId}`,
          JSON.stringify({ ...parsed, expiredAt: Date.now(), adminExpired: false }),
          { expirationTtl: 30 * 24 * 3600 }
        );
        await env.SECRETS_KV.delete(key.name);
        archived++;
      }
    } catch (err) { console.error('Cleanup error:', key.name, err); }
  }

  console.log(`Cleanup complete: ${archived} archived, ${cleaned} already gone`);
}
