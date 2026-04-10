// ===================================
// MIDDLEWARE - PAGE ROUTING
// File: functions/_middleware.js
// ===================================

/**
 * This middleware handles HTML page routing
 * It must run BEFORE the API handler
 */

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Don't interfere with API routes
  if (path.startsWith('/api/')) {
    return next();
  }

  // Admin portal - exact match
  if (path === '/admin' || path === '/admin/') {
    return context.env.ASSETS.fetch(new Request(new URL('/admin.html', url.origin), request));
  }

  // View secret page - matches /view/{uuid}
  // The fragment (#key) stays in the browser and never reaches the server
  if (path.match(/^\/view\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return context.env.ASSETS.fetch(new Request(new URL('/view.html', url.origin), request));
  }

  // Let other requests pass through
  return next();
}