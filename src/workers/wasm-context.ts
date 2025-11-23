let wasmModule: any = null;
let wasmMemory: WebAssembly.Memory | null = null;
let wasmInitialized = false;

export const bufferPool: Map<number, unknown> = new Map<number, unknown>();

export const USE_BINARY_ENCODING = true;
export const USE_PARALLEL_PROCESSING = true;

export function getWasmModule(): any {
  if (!wasmInitialized) {
    throw new Error("WASM not initialized");
  }
  return wasmModule;
}

export function getWasmInstance(): any {
  return getWasmModule();
}

export function getWasmMemory(): WebAssembly.Memory {
  if (!wasmMemory) {
    throw new Error("WASM memory not available");
  }
  return wasmMemory;
}

export function isWasmReady(): boolean {
  return wasmInitialized;
}

export async function initWasm(): Promise<void> {
  if (wasmInitialized) {
    return;
  }

  console.log("[CSV Worker] WASM init start");

  try {
    console.log("[CSV Worker] Importing WASM glue...");
    const glue: any = await import("../../src-wasm/pkg/csv_diff_wasm.js");
    console.log("[CSV Worker] Glue imported. Typeof glue:", typeof glue);
    console.log("[CSV Worker] Glue keys:", Object.keys(glue || {}));
    console.log("[CSV Worker] initSync exists:", !!glue.initSync);
    console.log("[CSV Worker] glue.default exists:", !!glue.default);
    console.log("[CSV Worker] init_panic_hook exists:", !!glue.init_panic_hook);
    console.log(
      "[CSV Worker] init_panic_hook typeof:",
      typeof glue?.init_panic_hook,
    );
    console.log("[CSV Worker] Skipping init_panic_hook to test...");
    // glue.init_panic_hook?.();
    console.log("[CSV Worker] init_panic_hook skipped");
    console.log(
      "[CSV Worker] SharedArrayBuffer available:",
      typeof SharedArrayBuffer !== "undefined",
    );
    console.log("[CSV Worker] glue.Module exists:", !!glue.Module);
    console.log(
      "[CSV Worker] glue.default?.Module exists:",
      !!(glue.default && glue.default.Module),
    );
    wasmModule = glue.default || glue;
    wasmMemory = glue.memory || null;

    try {
      console.log("[CSV Worker] About to call init_thread_pool...");
      console.log(
        "[CSV Worker] init_thread_pool exists:",
        !!glue.init_thread_pool,
      );
      console.log(
        "[CSV Worker] typeof glue.init_thread_pool:",
        typeof glue.init_thread_pool,
      );
      glue.init_thread_pool?.();
      console.log("[CSV Worker] init_thread_pool called successfully");
    } catch (e: unknown) {
      console.error(
        "[CSV Worker] Thread pool init failed:",
        e,
        (e as Error).stack || (e as any).stack,
      );
    }

    console.log(
      "[CSV Worker] Fetching WASM binary from src-wasm/pkg/csv_diff_wasm_bg.wasm...",
    );
    const wasmUrl = new URL(
      "../../src-wasm/pkg/csv_diff_wasm_bg.wasm",
      import.meta.url,
    ).href;
    console.log("[CSV Worker] WASM URL:", wasmUrl);
    const response = await fetch(wasmUrl);
    console.log(
      "[CSV Worker] Fetch response status:",
      response.status,
      response.statusText,
    );
    console.log("[CSV Worker] Fetch response ok:", response.ok);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch WASM module: ${response.status} ${response.statusText}`,
      );
    }
    const wasmArrayBuffer = await response.arrayBuffer();
    const wasmBytes = new Uint8Array(wasmArrayBuffer);
    console.log("[CSV Worker] WASM bytes loaded, length:", wasmBytes.length);
    console.log("[CSV Worker] About to call initSync(wasmBytes)...");
    glue.initSync(wasmBytes);
    console.log("[CSV Worker] initSync completed successfully");

    wasmInitialized = true;
    console.log("[CSV Worker] WASM init complete");
  } catch (error: unknown) {
    console.error("[CSV Worker] WASM init error:", error);
    throw error;
  }
}
