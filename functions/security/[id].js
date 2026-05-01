// ===================================
// VIEW PAGE DYNAMIC ROUTE
// File: functions/view/[id].js
// ===================================

/**
 * This handles /view/{id} routes
 * The [id] syntax makes Cloudflare Pages capture the ID as params.id
 */

export async function onRequest(context) {
  const { params, env } = context;
  const secretId = params.id;

  // Fetch the view.html asset
  const viewHtmlUrl = new URL('/view.html', new URL(context.request.url).origin);
  const response = await env.ASSETS.fetch(viewHtmlUrl);
  return response;
}
