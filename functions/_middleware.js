// ===================================
// MIDDLEWARE - PAGE ROUTING
// File: functions/_middleware.js
// ===================================

/**
 * This middleware handles HTML page routing
 * It must run BEFORE the API handler
 */

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  console.log('[MIDDLEWARE] Request:', path);

  // Don't interfere with API routes - let them pass through
  if (path.startsWith('/api/')) {
    console.log('[MIDDLEWARE] API route, passing through');
    return next();
  }

  // Admin portal - exact match
  if (path === '/admin' || path === '/admin/') {
    console.log('[MIDDLEWARE] Serving admin.html');
    return env.ASSETS.fetch(new Request(new URL('/admin.html', url.origin), request));
  }

  // View secret page - matches /view/{uuid}
  // The fragment (#key) stays in the browser and never reaches the server
  const viewMatch = path.match(/^\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (viewMatch) {
    console.log('[MIDDLEWARE] Serving view.html for secret:', viewMatch[1]);
    return env.ASSETS.fetch(new Request(new URL('/view.html', url.origin), request));
  }

  // Homepage - exact match
  if (path === '/' || path === '/index.html') {
    console.log('[MIDDLEWARE] Serving index.html');
    return env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), request));
  }

  // Let other requests (CSS, JS, images, etc.) pass through
  console.log('[MIDDLEWARE] Passing through to static assets');
  return next();
}