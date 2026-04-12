// ===================================
// VIEW PAGE DYNAMIC ROUTE
// File: functions/view/[id].js
// ===================================

/**
 * This handles /view/{id} routes
 * The [id] syntax makes Cloudflare Pages capture the ID as params.id
 */

export async function onRequest(context) {
  const { params, env, request } = context;
  const secretId = params.id;
  
  console.log('[VIEW HANDLER] Request URL:', request.url);
  console.log('[VIEW HANDLER] Secret ID from params:', secretId);
  console.log('[VIEW HANDLER] Original pathname:', new URL(request.url).pathname);
  
  // Fetch the view.html asset
  // We need to construct a new URL that points to /view.html on the same origin
  const viewHtmlUrl = new URL('/view.html', new URL(request.url).origin);
  
  console.log('[VIEW HANDLER] Fetching:', viewHtmlUrl.href);
  
  const response = await env.ASSETS.fetch(viewHtmlUrl);
  
  console.log('[VIEW HANDLER] Response status:', response.status);
  
  return response;
}
