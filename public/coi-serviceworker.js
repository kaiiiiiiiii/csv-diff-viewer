/* eslint-disable */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function handleFetch(request) {
  const response = await fetch(request);

  // Opaque responses (status 0) can't be re-wrapped with new Response(); pass them through
  if (response.status === 0) return response;

  const newHeaders = new Headers(response.headers);
  newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
  newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

self.addEventListener("fetch", (e) => {
  // Browsers reject only-if-cached requests that aren't same-origin, so let them go
  // straight to the network instead of answering with an undefined response
  if (
    e.request.cache === "only-if-cached" &&
    e.request.mode !== "same-origin"
  ) {
    return;
  }
  e.respondWith(handleFetch(e.request));
});
