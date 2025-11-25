/* eslint-disable */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function handleFetch(request) {
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return;
  }

  const response = await fetch(request);

  const newHeaders = new Headers(response.headers);
  newHeaders.set("Cross-Origin-Embedder-Policy", "credentialless");
  newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

self.addEventListener("fetch", (e) => {
  e.respondWith(handleFetch(e.request));
});
