/**
 * _security.js — shared security primitives for Shh Secrets
 * File: functions/_security.js
 *
 * OWASP Top 10 mitigations addressed:
 *
 * A01 Broken Access Control    → timing-safe admin key comparison
 * A02 Cryptographic Failures   → secrets only via env vars; no sensitive data in error bodies
 * A03 Injection                → strict input validation; URL parsed via native URL API
 * A04 Insecure Design          → client-side E2EE; zero-knowledge server architecture
 * A05 Security Misconfiguration→ security headers on every response; minimal error exposure
 * A06 Vulnerable Components    → zero npm dependencies; native Workers runtime only
 * A07 Auth Failures            → timing-safe key comparison; rate limiting
 * A08 Data Integrity           → input validated before KV write; AES-GCM authenticated encryption
 * A09 Logging & Monitoring     → Discord webhook logging; structured metadata
 * A10 SSRF                     → N/A (no server-side URL fetching)
 */

// ─── Security Headers ────────────────────────────────────────────────────────

/**
 * Apply comprehensive security headers to all responses
 */
export function applySecurityHeaders(headers = {}) {
  return {
    ...headers,
    // Prevent clickjacking
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    
    // Prevent MIME sniffing
    'X-Content-Type-Options': 'nosniff',
    
    // XSS protection (legacy browsers)
    'X-XSS-Protection': '1; mode=block',
    
    // Force HTTPS
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    
    // Referrer policy
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    
    // Permissions policy
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };
}

// ─── Timing-Safe Comparison ──────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks
 * Used for admin token validation
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Do NOT early-return on length mismatch — that leaks whether the
  // attacker's guess has the right character count (timing side-channel).
  // Instead, always iterate max(a,b) characters and fold the length
  // difference into the result accumulator.
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length; // non-zero if lengths differ

  for (let i = 0; i < maxLen; i++) {
    const aChar = i < a.length ? a.charCodeAt(i) : 0;
    const bChar = i < b.length ? b.charCodeAt(i) : 0;
    result |= aChar ^ bChar;
  }

  return result === 0;
}

// ─── Input Validation ────────────────────────────────────────────────────────

/**
 * Validate UUID format for secret IDs
 */
export function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Validate TTL value
 */
export function isValidTTL(ttl, maxHours = 24) {
  const num = parseInt(ttl);
  return !isNaN(num) && num >= 1 && num <= maxHours;
}

/**
 * Sanitize and validate encrypted data
 */
export function validateEncryptedData(data, maxSize = 4096) {
  if (typeof data !== 'string') {
    return { valid: false, error: 'Encrypted data must be a string' };
  }
  
  if (data.length === 0) {
    return { valid: false, error: 'Encrypted data cannot be empty' };
  }
  
  if (data.length > maxSize) {
    return { valid: false, error: `Encrypted data exceeds maximum size of ${maxSize} bytes` };
  }
  
  // Base64url validation (allow URL-safe base64)
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  if (!base64urlRegex.test(data)) {
    return { valid: false, error: 'Invalid encrypted data format' };
  }
  
  return { valid: true };
}

// ─── Error Sanitization ──────────────────────────────────────────────────────

/**
 * Create safe error response (no sensitive data in production)
 */
export function sanitizeError(error, isDevelopment = false) {
  if (isDevelopment) {
    return {
      error: 'Internal server error',
      message: error.message,
      stack: error.stack,
    };
  }
  
  return {
    error: 'Internal server error',
    // Never expose error details in production
  };
}

// ─── Content Validation ──────────────────────────────────────────────────────

/**
 * Validate file metadata (when file uploads are enabled)
 */
export function validateFileMetadata(file, maxSize = 10 * 1024 * 1024) {
  if (!file.name || typeof file.name !== 'string') {
    return { valid: false, error: 'Invalid file name' };
  }
  
  if (file.name.length > 255) {
    return { valid: false, error: 'File name too long' };
  }
  
  if (!file.size || typeof file.size !== 'number') {
    return { valid: false, error: 'Invalid file size' };
  }
  
  if (file.size > maxSize) {
    return { valid: false, error: `File exceeds maximum size of ${(maxSize / 1024 / 1024).toFixed(1)} MB` };
  }
  
  if (!file.data || typeof file.data !== 'string') {
    return { valid: false, error: 'Invalid file data' };
  }
  
  // Encrypted file data will be ~133% of original size (base64) plus IV
  // Allow encrypted data to be larger than original file size
  const maxEncryptedSize = Math.ceil(maxSize * 1.4); // 40% overhead
  if (file.data.length > maxEncryptedSize) {
    return { valid: false, error: `Encrypted file data too large (${file.data.length} bytes)` };
  }
  
  return { valid: true };
}

// ─── IP Validation ───────────────────────────────────────────────────────────

/**
 * Get client IP from request (Cloudflare-specific)
 */
export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 
         request.headers.get('X-Forwarded-For')?.split(',')[0] ||
         'unknown';
}

// ─── Admin Token Validation ──────────────────────────────────────────────────

/**
 * Validate admin authentication with timing-safe comparison
 */
export function validateAdminToken(request, env, headerName = 'X-Admin-Token') {
  const providedToken = request.headers.get(headerName);
  const expectedToken = env.ADMIN_TOKEN;
  
  if (!providedToken || !expectedToken) {
    return false;
  }
  
  return timingSafeEqual(providedToken, expectedToken);
}

// ─── CORS Headers ────────────────────────────────────────────────────────────

/**
 * Get CORS headers for API responses
 */
export function getCORSHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

// ─── KV Key Generation ───────────────────────────────────────────────────────

/**
 * Generate safe KV key with namespace prefix
 */
export function generateSecretKey(secretId) {
  if (!isValidUUID(secretId)) {
    throw new Error('Invalid secret ID format');
  }
  return `secret:${secretId}`;
}

/**
 * Generate rate limit key
 */
export function generateRateLimitKey(action, clientIP, timestamp = new Date()) {
  const hour = timestamp.toISOString().slice(0, 13);
  return `ratelimit:${action}:${clientIP}:${hour}`;
}