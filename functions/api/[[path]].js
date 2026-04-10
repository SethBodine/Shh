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

// FEATURE FLAGS - These cannot be modified from browser
const FEATURES = {
  FILE_UPLOADS_ENABLED: false, // Set to true to enable file uploads up to 10MB
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_TEXT_SIZE: 1024, // 1KB for text (encrypted will be ~2KB)
  MAX_TTL_HOURS: 24,
  DISCORD_WEBHOOK_ENABLED: true,
};

// Rate limiting configuration - Override via Cloudflare environment variables
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

  // Validate KV namespace binding
  if (!env.SECRETS_KV) {
    console.error('KV namespace binding not found');
    return new Response(JSON.stringify({ 
      error: 'Service configuration error' 
    }), {
      status: 503,
      headers: applySecurityHeaders({
        'Content-Type': 'application/json',
        ...getCORSHeaders(),
      }),
    });
  }

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { 
      headers: applySecurityHeaders(getCORSHeaders())
    });
  }

  const clientIP = getClientIP(request);
  const RATE_LIMITS = getRateLimits(env);
  const corsHeaders = getCORSHeaders();

  // Rate limiting helper
  async function checkRateLimit(action, limit) {
    const rateLimitKey = generateRateLimitKey(action, clientIP);
    const current = await env.SECRETS_KV.get(rateLimitKey);
    const count = current ? parseInt(current) : 0;
    
    if (count >= limit) {
      return false;
    }
    
    await env.SECRETS_KV.put(rateLimitKey, (count + 1).toString(), { 
      expirationTtl: 3600 
    });
    return true;
  }

  // Discord notification helper
  async function sendDiscordNotification(data) {
    if (!FEATURES.DISCORD_WEBHOOK_ENABLED || !env.DISCORD_WEBHOOK_URL) return;

    const embed = {
      embeds: [{
        title: data.title || 'Secret Activity',
        color: data.color || 3447003,
        fields: [
          { name: 'Source IP', value: clientIP, inline: true },
          { name: 'TTL', value: `${data.ttl || 0} hours`, inline: true },
          { name: 'Size', value: `${data.messageLength || 0} bytes`, inline: true },
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

  try {
    // ==========================================
    // HEALTH CHECK
    // ==========================================
    if (request.method === 'GET' && path === 'health') {
      return new Response(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        features: {
          fileUploads: FEATURES.FILE_UPLOADS_ENABLED,
          maxFileSize: FEATURES.MAX_FILE_SIZE,
          maxTextSize: FEATURES.MAX_TEXT_SIZE,
          maxTTL: FEATURES.MAX_TTL_HOURS,
          e2ee: true,
          zeroKnowledge: true,
        },
        kvBound: !!env.SECRETS_KV,
        adminTokenSet: !!env.ADMIN_TOKEN,
        discordWebhookSet: !!env.DISCORD_WEBHOOK_URL,
        rateLimits: RATE_LIMITS,
      }), {
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          ...corsHeaders,
        }),
      });
    }

    // ==========================================
    // CREATE SECRET
    // ==========================================
    if (request.method === 'POST' && path === 'secret') {
      // Rate limit check
      if (!await checkRateLimit('create', RATE_LIMITS.CREATE_SECRET_PER_IP_PER_HOUR)) {
        await sendDiscordNotification({
          title: '🚨 Rate Limit Exceeded - Create',
          color: 15158332,
        });
        
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded. Please try again later.' 
        }), {
          status: 429,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      const data = await request.json();
      const { encryptedData, ttl = 24, files = [] } = data;

      // Validate TTL
      if (!isValidTTL(ttl, FEATURES.MAX_TTL_HOURS)) {
        return new Response(JSON.stringify({ 
          error: `TTL must be between 1 and ${FEATURES.MAX_TTL_HOURS} hours` 
        }), {
          status: 400,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      // Validate encrypted data
      const validation = validateEncryptedData(encryptedData, FEATURES.MAX_TEXT_SIZE * 2);
      if (!validation.valid) {
        return new Response(JSON.stringify({ 
          error: validation.error 
        }), {
          status: 400,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      // Validate files
      if (files.length > 0) {
        if (!FEATURES.FILE_UPLOADS_ENABLED) {
          return new Response(JSON.stringify({ 
            error: 'File uploads are not enabled' 
          }), {
            status: 403,
            headers: applySecurityHeaders({
              'Content-Type': 'application/json',
              ...corsHeaders,
            }),
          });
        }

        for (const file of files) {
          const fileValidation = validateFileMetadata(file, FEATURES.MAX_FILE_SIZE);
          if (!fileValidation.valid) {
            return new Response(JSON.stringify({ 
              error: fileValidation.error 
            }), {
              status: 400,
              headers: applySecurityHeaders({
                'Content-Type': 'application/json',
                ...corsHeaders,
              }),
            });
          }
        }
      }

      // Generate unique ID
      const secretId = crypto.randomUUID();
      
      // Prepare secret data (ENCRYPTED - server never sees plaintext)
      const secretData = {
        encryptedData,
        files,
        createdAt: Date.now(),
        viewed: false,
        clientIP, // For audit trail
      };

      // Store in KV with TTL
      const ttlSeconds = ttl * 3600;
      const kvKey = generateSecretKey(secretId);
      
      await env.SECRETS_KV.put(
        kvKey,
        JSON.stringify(secretData),
        { expirationTtl: ttlSeconds }
      );

      // Send Discord notification
      await sendDiscordNotification({
        title: '🔒 Secret Created (E2EE)',
        color: 3066993,
        ttl,
        messageLength: encryptedData.length,
        files: files.map(f => f.name),
      });

      return new Response(JSON.stringify({
        id: secretId,
        expiresIn: ttl,
      }), {
        status: 201,
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          ...corsHeaders,
        }),
      });
    }

    // ==========================================
    // GET SECRET METADATA (before viewing)
    // ==========================================
    if (request.method === 'GET' && path.startsWith('secret/') && path.endsWith('/metadata')) {
      const secretId = path.split('/')[1];
      
      if (!isValidUUID(secretId)) {
        return new Response(JSON.stringify({ 
          error: 'Invalid secret ID format' 
        }), {
          status: 400,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      const kvKey = generateSecretKey(secretId);
      const secretData = await env.SECRETS_KV.get(kvKey);
      
      if (!secretData) {
        return new Response(JSON.stringify({ 
          error: 'Secret not found or already consumed' 
        }), {
          status: 404,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      const parsed = JSON.parse(secretData);
      
      return new Response(JSON.stringify({
        exists: true,
        viewed: parsed.viewed,
        hasFiles: parsed.files && parsed.files.length > 0,
        fileCount: parsed.files?.length || 0,
      }), {
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          ...corsHeaders,
        }),
      });
    }

    // ==========================================
    // VIEW SECRET (one-time consumption)
    // ==========================================
    if (request.method === 'POST' && path.startsWith('secret/') && path.endsWith('/view')) {
      // Rate limit check
      if (!await checkRateLimit('view', RATE_LIMITS.VIEW_SECRET_PER_IP_PER_HOUR)) {
        await sendDiscordNotification({
          title: '🚨 Rate Limit Exceeded - View',
          color: 15158332,
        });
        
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded. Please try again later.' 
        }), {
          status: 429,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      const secretId = path.split('/')[1];
      
      if (!isValidUUID(secretId)) {
        return new Response(JSON.stringify({ 
          error: 'Invalid secret ID format' 
        }), {
          status: 400,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      const kvKey = generateSecretKey(secretId);
      const secretData = await env.SECRETS_KV.get(kvKey);
      
      if (!secretData) {
        return new Response(JSON.stringify({ 
          error: 'Secret not found or already consumed' 
        }), {
          status: 404,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      const parsed = JSON.parse(secretData);

      // Delete immediately (one-time use)
      await env.SECRETS_KV.delete(kvKey);

      // Send Discord notification
      await sendDiscordNotification({
        title: '👁️ Secret Viewed (E2EE)',
        color: 15158332,
        messageLength: parsed.encryptedData?.length || 0,
        files: parsed.files?.map(f => f.name) || [],
      });

      // Return encrypted data (client decrypts with key from URL fragment)
      return new Response(JSON.stringify({
        encryptedData: parsed.encryptedData,
        files: parsed.files,
      }), {
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          ...corsHeaders,
        }),
      });
    }

    // ==========================================
    // ADMIN: GET STATS
    // ==========================================
    if (request.method === 'GET' && path === 'admin/stats') {
      if (!validateAdminToken(request, env)) {
        return new Response(JSON.stringify({ 
          error: 'Unauthorized' 
        }), {
          status: 401,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      const list = await env.SECRETS_KV.list({ prefix: 'secret:' });
      
      return new Response(JSON.stringify({
        totalSecrets: list.keys.length,
        secrets: list.keys.map(k => ({
          id: k.name.replace('secret:', ''),
        })),
      }), {
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          ...corsHeaders,
        }),
      });
    }

    // ==========================================
    // ADMIN: PURGE ALL SECRETS
    // ==========================================
    if (request.method === 'POST' && path === 'admin/purge') {
      if (!validateAdminToken(request, env)) {
        return new Response(JSON.stringify({ 
          error: 'Unauthorized' 
        }), {
          status: 401,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      // Rate limit admin actions
      if (!await checkRateLimit('admin', RATE_LIMITS.ADMIN_ACTION_PER_HOUR)) {
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded for admin actions' 
        }), {
          status: 429,
          headers: applySecurityHeaders({
            'Content-Type': 'application/json',
            ...corsHeaders,
          }),
        });
      }

      const list = await env.SECRETS_KV.list({ prefix: 'secret:' });
      
      await Promise.all(
        list.keys.map(key => env.SECRETS_KV.delete(key.name))
      );

      await sendDiscordNotification({
        title: '🗑️ Admin Purge',
        color: 10038562,
      });

      return new Response(JSON.stringify({
        purged: list.keys.length,
      }), {
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          ...corsHeaders,
        }),
      });
    }

    return new Response(JSON.stringify({ 
      error: 'Not Found' 
    }), { 
      status: 404,
      headers: applySecurityHeaders({
        'Content-Type': 'application/json',
        ...corsHeaders,
      }),
    });

  } catch (error) {
    console.error('Error:', error);
    
    const isDevelopment = env.ENVIRONMENT === 'development';
    
    return new Response(JSON.stringify(
      sanitizeError(error, isDevelopment)
    ), {
      status: 500,
      headers: applySecurityHeaders({
        'Content-Type': 'application/json',
        ...corsHeaders,
      }),
    });
  }
}

// ===================================
// SCHEDULED CLEANUP (Cron Trigger)
// ===================================
export async function scheduled(event, env, ctx) {
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
      const ttlMs = 24 * 60 * 60 * 1000;
      
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