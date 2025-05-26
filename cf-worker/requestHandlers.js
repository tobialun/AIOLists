// ./cf-worker/requestHandlers.js

export async function handleApiRequest(request, action) {
    console.log(`Worker: handleApiRequest called for action: ${action}, path: ${new URL(request.url).pathname}`);
    return new Response(JSON.stringify({
      message: `API action '${action}' received by worker. Handler not fully implemented.`,
      params: request.params, // if using itty-router with withParams
      query: request.query,    // if using itty-router
    }), {
      status: 501, // Not Implemented
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  export async function handleManifestRequest(request) {
    console.log(`Worker: handleManifestRequest called for path: ${new URL(request.url).pathname}`);
    return new Response(JSON.stringify({ error: 'Manifest handler not fully implemented in worker adapter.' }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  export async function handleCatalogRequest(request) {
    console.log(`Worker: handleCatalogRequest called for path: ${new URL(request.url).pathname}`);
    return new Response(JSON.stringify({ error: 'Catalog handler not fully implemented in worker adapter.' }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  export async function handleStaticConfigRequest(request) {
      console.log(`Worker: handleStaticConfigRequest called for path: ${new URL(request.url).pathname}`);
      return new Response(JSON.stringify({ error: 'Static config handler not fully implemented in worker adapter.' }), {
          status: 501,
          headers: { 'Content-Type': 'application/json' }
      });
  }
  
  export function handleRootRedirect(request) {
      const url = new URL(request.url);
      return Response.redirect(`${url.origin}/configure`, 302);
  }
  
  export function handleConfigureRequest(request, configHash = null) {
      console.log(`Worker: handleConfigureRequest for path ${request.url}. ConfigHash: ${configHash}. Expecting Workers Sites to serve public/index.html.`);
      // This response indicates the worker was hit, likely meaning a static file wasn't served.
      return new Response("Configure page should be served by Workers Sites. If you see this, check your [site] config in wrangler.toml or the path.", { status: 404, headers: {'Content-Type': 'text/plain'} });
  }
  
  export function handleImportSharedRequest(request) {
      console.log(`Worker: handleImportSharedRequest for path ${request.url}. Expecting Workers Sites to serve public/index.html.`);
      return new Response("Import shared page should be served by Workers Sites. If you see this, check your [site] config in wrangler.toml or the path.", { status: 404, headers: {'Content-Type': 'text/plain'} });
  }