// ===================================
// ADMIN PAGE ROUTE
// File: functions/admin.js
// ===================================

/**
 * This handles /admin route
 */

export async function onRequest(context) {
  const { env, request } = context;

  // Serve admin.html.
  // IMPORTANT: do NOT forward the original `request` object as the second
  // argument to new Request() — doing so preserves the original /admin URL
  // in the request internals, which causes Cloudflare's asset server to
  // issue a 308 redirect back to /admin → loop.
  // Instead, fetch only the target URL (identical to how view/[id].js works).
  const adminHtmlUrl = new URL('/admin.html', new URL(request.url).origin);
  return env.ASSETS.fetch(adminHtmlUrl);
}
