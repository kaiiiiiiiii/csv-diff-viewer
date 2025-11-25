import { createMiddleware, createStart } from "@tanstack/react-start";

const crossOriginIsolationMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next();
    const response = result.response;

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
