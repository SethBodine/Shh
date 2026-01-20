// ===================================
// CLOUDFLARE WORKER - API BACKEND
// File: functions/api/[[path]].js
// ===================================

// FEATURE FLAGS - These cannot be modified from browser
const FEATURES = {
  FILE_UPLOADS_ENABLED: false, // Set to true to enable file uploads up to 10MB
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_TEXT_SIZE: 1024, // 1KB for text
  MAX_TTL_HOURS: 24,
  DISCORD_WEBHOOK_ENABLED: true,
};

// Admin authentication - set this in your Cloudflare Worker environment variables
// ADMIN_TOKEN should be a secure random string
const ADMIN_AUTH_HEADER = 'X-Admin-Token';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Helper function to send Discord notification
  async function sendDiscordNotification(data) {
    if (!FEATURES.DISCORD_WEBHOOK_ENABLED || !env.DISCORD_WEBHOOK_URL) return;

    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const embed = {
      embeds: [{
        title: data.title || 'Secret Activity',
        color: data.color || 3447003,
        fields: [
          { name: 'Source IP', value: clientIP, inline: true },
          { name: 'TTL', value: `${data.ttl} hours`, inline: true },
          { name: 'Message Length', value: `${data.messageLength} bytes`, inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    };

    if (data.files && data.files.length > 0) {
      embed.embeds[0].fields.push({
        name: 'Files',
        value: data.files.join(', '),
        inline: false,
      });
    }

    try {
      await fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(embed),
      });
    } catch (err) {
      console.error('Discord notification failed:', err);
    }
  }

  // Helper to verify admin token
  function isAdmin(request) {
    const token = request.headers.get(ADMIN_AUTH_HEADER);
    return token && token === env.ADMIN_TOKEN;
  }

  try {
    // ==========================================
    // CREATE SECRET
    // ==========================================
    if (request.method === 'POST' && path === 'secret') {
      const data = await request.json();
      const { text, ttl = 24, files = [] } = data;

      // Validate TTL
      if (ttl < 1 || ttl > FEATURES.MAX_TTL_HOURS) {
        return new Response(JSON.stringify({ 
          error: `TTL must be between 1 and ${FEATURES.MAX_TTL_HOURS} hours` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Validate text size
      if (text && text.length > FEATURES.MAX_TEXT_SIZE) {
        return new Response(JSON.stringify({ 
          error: `Text exceeds maximum size of ${FEATURES.MAX_TEXT_SIZE} bytes` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Validate files
      if (files.length > 0 && !FEATURES.FILE_UPLOADS_ENABLED) {
        return new Response(JSON.stringify({ 
          error: 'File uploads are not enabled' 
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate unique ID
      const secretId = crypto.randomUUID();
      
      // Prepare secret data
      const secretData = {
        text,
        files,
        createdAt: Date.now(),
        viewed: false,
      };

      // Store in KV with TTL (convert hours to seconds)
      const ttlSeconds = ttl * 3600;
      await env.SECRETS_KV.put(
        `secret:${secretId}`,
        JSON.stringify(secretData),
        { expirationTtl: ttlSeconds }
      );

      // Send Discord notification
      await sendDiscordNotification({
        title: '🔒 Secret Created',
        color: 3066993, // Green
        ttl,
        messageLength: text?.length || 0,
        files: files.map(f => f.name),
      });

      return new Response(JSON.stringify({
        id: secretId,
        url: `${url.origin}/view/${secretId}`,
        expiresIn: ttl,
      }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // GET SECRET METADATA (before viewing)
    // ==========================================
    if (request.method === 'GET' && path.startsWith('secret/') && path.endsWith('/metadata')) {
      const secretId = path.split('/')[1];
      
      const secretData = await env.SECRETS_KV.get(`secret:${secretId}`);
      
      if (!secretData) {
        return new Response(JSON.stringify({ 
          error: 'Secret not found or already consumed' 
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const parsed = JSON.parse(secretData);
      
      return new Response(JSON.stringify({
        exists: true,
        viewed: parsed.viewed,
        hasFiles: parsed.files && parsed.files.length > 0,
        fileCount: parsed.files?.length || 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // VIEW SECRET (one-time consumption)
    // ==========================================
    if (request.method === 'POST' && path.startsWith('secret/') && path.endsWith('/view')) {
      const secretId = path.split('/')[1];
      
      const secretData = await env.SECRETS_KV.get(`secret:${secretId}`);
      
      if (!secretData) {
        return new Response(JSON.stringify({ 
          error: 'Secret not found or already consumed' 
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const parsed = JSON.parse(secretData);

      // Delete immediately (one-time use)
      await env.SECRETS_KV.delete(`secret:${secretId}`);

      // Send Discord notification
      await sendDiscordNotification({
        title: '👁️ Secret Viewed',
        color: 15158332, // Red
        ttl: 0,
        messageLength: parsed.text?.length || 0,
        files: parsed.files?.map(f => f.name) || [],
      });

      return new Response(JSON.stringify({
        text: parsed.text,
        files: parsed.files,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // ADMIN: GET STATS
    // ==========================================
    if (request.method === 'GET' && path === 'admin/stats') {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // List all secrets (keys only)
      const list = await env.SECRETS_KV.list({ prefix: 'secret:' });
      
      return new Response(JSON.stringify({
        totalSecrets: list.keys.length,
        secrets: list.keys.map(k => ({
          id: k.name.replace('secret:', ''),
          // We don't include the actual secret content for security
        })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // ADMIN: PURGE ALL SECRETS
    // ==========================================
    if (request.method === 'POST' && path === 'admin/purge') {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const list = await env.SECRETS_KV.list({ prefix: 'secret:' });
      
      // Delete all secrets
      await Promise.all(
        list.keys.map(key => env.SECRETS_KV.delete(key.name))
      );

      // Send Discord notification
      await sendDiscordNotification({
        title: '🗑️ Admin Purge',
        color: 10038562, // Purple
        ttl: 0,
        messageLength: 0,
      });

      return new Response(JSON.stringify({
        purged: list.keys.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // HEALTH CHECK
    // ==========================================
    if (request.method === 'GET' && path === 'health') {
      return new Response(JSON.stringify({
        status: 'ok',
        features: {
          fileUploads: FEATURES.FILE_UPLOADS_ENABLED,
          maxFileSize: FEATURES.MAX_FILE_SIZE,
          maxTextSize: FEATURES.MAX_TEXT_SIZE,
          maxTTL: FEATURES.MAX_TTL_HOURS,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ===================================
// SCHEDULED CLEANUP (Cron Trigger)
// ===================================
export async function scheduled(event, env, ctx) {
  // This runs on a schedule to clean up expired secrets
  // Note: KV automatically expires keys based on TTL, but this provides
  // a backup cleanup mechanism
  
  const list = await env.SECRETS_KV.list({ prefix: 'secret:' });
  let cleaned = 0;

  for (const key of list.keys) {
    const data = await env.SECRETS_KV.get(key.name);
    if (!data) {
      cleaned++;
      continue;
    }

    const parsed = JSON.parse(data);
    const ttlMs = 24 * 60 * 60 * 1000; // Max 24 hours
    
    if (Date.now() - parsed.createdAt > ttlMs) {
      await env.SECRETS_KV.delete(key.name);
      cleaned++;
    }
  }

  console.log(`Cleaned up ${cleaned} expired secrets`);
}
