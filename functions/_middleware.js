// ===================================
// MIDDLEWARE - PAGE ROUTING
// File: functions/_middleware.js
// ===================================

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Skip API routes
  if (path.startsWith('/api/')) {
    return next();
  }

  // Admin portal
  if (path === '/admin' || path === '/admin/') {
    return env.ASSETS.fetch(new Request(new URL('/admin.html', url.origin), request));
  }

  // View secret - MUST match /view/{uuid} pattern
  if (path.startsWith('/view/') && path !== '/view/' && path !== '/view') {
    // Extract the ID part
    const idPart = path.substring('/view/'.length);
    // Check if it looks like a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idPart)) {
      return env.ASSETS.fetch(new Request(new URL('/view.html', url.origin), request));
    }
  }

  // Everything else passes through (including /, /index.html, static assets)
  return next();
}