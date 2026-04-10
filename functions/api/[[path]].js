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

// Rate limiting configuration - Override via Cloudflare environment variables
// These are defaults if env vars are not set
function getRateLimits(env) {
  return {
    CREATE_SECRET_PER_IP_PER_HOUR: parseInt(env.RATE_LIMIT_CREATE || '10'),
    VIEW_SECRET_PER_IP_PER_HOUR: parseInt(env.RATE_LIMIT_VIEW || '50'),
    ADMIN_ACTION_PER_HOUR: parseInt(env.RATE_LIMIT_ADMIN || '5'),
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');

  // CRITICAL SECURITY CHECK: Validate KV namespace binding
  if (!env.SECRETS_KV) {
    console.error('SECURITY ALERT: KV namespace binding not found!');
    console.error('Environment keys:', Object.keys(env));
    return new Response(JSON.stringify({ 
      error: 'Service configuration error - KV namespace not bound' 
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate KV namespace is correctly bound (check for expected methods)
  if (typeof env.SECRETS_KV.get !== 'function' || typeof env.SECRETS_KV.put !== 'function') {
    console.error('SECURITY ALERT: KV namespace binding is invalid!');
    return new Response(JSON.stringify({ 
      error: 'Service configuration error - Invalid KV binding' 
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Rate limiting helper
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const RATE_LIMITS = getRateLimits(env);
  
  async function checkRateLimit(action, limit) {
    const rateLimitKey = `ratelimit:${action}:${clientIP}:${new Date().toISOString().slice(0, 13)}`; // Hour-based
    const current = await env.SECRETS_KV.get(rateLimitKey);
    const count = current ? parseInt(current) : 0;
    
    if (count >= limit) {
      return false;
    }
    
    await env.SECRETS_KV.put(rateLimitKey, (count + 1).toString(), { expirationTtl: 3600 });
    return true;
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
          { name: 'Encrypted Size', value: `${data.messageLength} bytes`, inline: true },
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
  function isAdmin(request, env) {
    const token = request.headers.get(ADMIN_AUTH_HEADER);
    if (!token || !env.ADMIN_TOKEN) {
      console.log('Admin check failed: token or ADMIN_TOKEN missing');
      return false;
    }
    const isValid = token === env.ADMIN_TOKEN;
    console.log('Admin token valid:', isValid);
    return isValid;
  }

  try {
    // ==========================================
    // CREATE SECRET
    // ==========================================
    if (request.method === 'POST' && path === 'secret') {
      // Rate limit check
      if (!await checkRateLimit('create', RATE_LIMITS.CREATE_SECRET_PER_IP_PER_HOUR)) {
        await sendDiscordNotification({
          title: '🚨 Rate Limit Exceeded',
          color: 15158332, // Red
          ttl: 0,
          messageLength: 0,
        });
        
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded. Please try again later.' 
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await request.json();
      const { encryptedData, ttl = 24, files = [] } = data;

      // Validate TTL
      if (ttl < 1 || ttl > FEATURES.MAX_TTL_HOURS) {
        return new Response(JSON.stringify({ 
          error: `TTL must be between 1 and ${FEATURES.MAX_TTL_HOURS} hours` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Validate encrypted data size (should be base64 encoded ciphertext)
      if (encryptedData && encryptedData.length > FEATURES.MAX_TEXT_SIZE * 2) {
        return new Response(JSON.stringify({ 
          error: `Encrypted data exceeds maximum size` 
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

      // Generate unique ID (this is the reference, NOT the decryption key)
      const secretId = crypto.randomUUID();
      
      // Prepare secret data - ENCRYPTED, server never sees plaintext
      const secretData = {
        encryptedData,  // Client-side encrypted data
        files,          // Files are also encrypted client-side
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

      // Send Discord notification - NEVER log the encryption key
      await sendDiscordNotification({
        title: '🔒 Secret Created (Encrypted)',
        color: 3066993, // Green
        ttl,
        messageLength: encryptedData?.length || 0,
        files: files.map(f => f.name),
      });

      // Return the secret ID only
      // The encryption key is generated client-side and NEVER sent to server
      return new Response(JSON.stringify({
        id: secretId,  // This is just the reference
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
      // Rate limit check
      if (!await checkRateLimit('view', RATE_LIMITS.VIEW_SECRET_PER_IP_PER_HOUR)) {
        await sendDiscordNotification({
          title: '🚨 Rate Limit Exceeded - View Attempts',
          color: 15158332, // Red
          ttl: 0,
          messageLength: 0,
        });
        
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded. Please try again later.' 
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

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
        title: '👁️ Secret Viewed (Encrypted)',
        color: 15158332, // Red
        ttl: 0,
        messageLength: parsed.encryptedData?.length || 0,
        files: parsed.files?.map(f => f.name) || [],
      });

      // Return encrypted data - client will decrypt with key from URL fragment
      return new Response(JSON.stringify({
        encryptedData: parsed.encryptedData,
        files: parsed.files,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // ADMIN: GET STATS
    // ==========================================
    if (request.method === 'GET' && path === 'admin/stats') {
      if (!isAdmin(request, env)) {
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
      if (!isAdmin(request, env)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Rate limit admin actions
      if (!await checkRateLimit('admin', RATE_LIMITS.ADMIN_ACTION_PER_HOUR)) {
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded for admin actions' 
        }), {
          status: 429,
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
        kvBound: !!env.SECRETS_KV,
        adminTokenSet: !!env.ADMIN_TOKEN,
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
      error: 'Internal server error',
      message: error.message,
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
  
  if (!env.SECRETS_KV) {
    console.error('KV namespace not available in scheduled function');
    return;
  }
  
  const list = await env.SECRETS_KV.list({ prefix: 'secret:' });
  let cleaned = 0;

  for (const key of list.keys) {
    const data = await env.SECRETS_KV.get(key.name);
    if (!data) {
      cleaned++;
      continue;
    }

    try {
      const parsed = JSON.parse(data);
      const ttlMs = 24 * 60 * 60 * 1000; // Max 24 hours
      
      if (Date.now() - parsed.createdAt > ttlMs) {
        await env.SECRETS_KV.delete(key.name);
        cleaned++;
      }
    } catch (err) {
      console.error('Error cleaning secret:', err);
    }
  }

  console.log(`Cleaned up ${cleaned} expired secrets`);
}