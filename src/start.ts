import { createMiddleware, createStart } from "@tanstack/react-start";

const crossOriginIsolationMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next();
    const response = result.response;

    // COEP is require-corp everywhere (no cross-origin subresources); keep in sync with vite.config.ts and public/coi-serviceworker.js
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");

    return {
      ...result,
      response,
    };
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [crossOriginIsolationMiddleware],
}));
