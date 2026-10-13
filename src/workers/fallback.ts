import { isDuplicateKeyError } from "./progress";

/**
 * Decide whether a failed parallel WASM call may be retried sequentially.
 * Rust `Err` values arrive as plain strings (data errors), duplicate-key errors
 * are data errors too, and a WebAssembly trap leaves the instance unusable, so
 * none of those are retried. Anything else (thread pool, SharedArrayBuffer,
 * DataCloneError, ...) is an environment problem the sequential path avoids.
 */
export function shouldFallbackToSequential(error: unknown): boolean {
  if (typeof error === "string") return false;
  if (
    typeof WebAssembly !== "undefined" &&
    error instanceof WebAssembly.RuntimeError
  ) {
    return false;
  }
  return !isDuplicateKeyError(error);
}

/** Normalise a non-retryable parallel failure into an Error for the caller. */
export function toFatalError(error: unknown): Error {
  if (
    typeof WebAssembly !== "undefined" &&
    error instanceof WebAssembly.RuntimeError
  ) {
    return new Error(
      `WebAssembly crashed (${error.message}); please reload the page`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
