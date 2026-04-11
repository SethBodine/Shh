// ===================================
// VIEW PAGE DYNAMIC ROUTE
// File: functions/view/[id].js
// ===================================

/**
 * This handles /view/{id} routes
 * Cloudflare Pages will automatically route /view/* here
 */

export async function onRequest(context) {
  const { params, env, request } = context;
  const secretId = params.id;
  
  // Just serve view.html - the JavaScript will extract the ID from the URL
  return env.ASSETS.fetch(new Request(new URL('/view.html', request.url), request));
}
