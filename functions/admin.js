// ===================================
// ADMIN PAGE ROUTE
// File: functions/admin.js
// ===================================

/**
 * This handles /admin route
 */

export async function onRequest(context) {
  const { env, request } = context;
  
  // Serve admin.html
  return env.ASSETS.fetch(new Request(new URL('/admin.html', request.url), request));
}