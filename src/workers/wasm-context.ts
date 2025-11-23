import { createWorkerLogger } from "./worker-logger";

let wasmModule: any = null;
let wasmMemory: WebAssembly.Memory | null = null;
let wasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;

const wasmLog = createWorkerLogger("WASM Init");
const threadLog = createWorkerLogger("WASM Threads");

export const bufferPool: Map<number, unknown> = new Map<number, unknown>();

export const USE_BINARY_ENCODING = Boolean(true);
export const USE_PARALLEL_PROCESSING = Boolean(true);

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

function isSharedMemoryImportMismatch(error: unknown): boolean {
  return (
    typeof WebAssembly !== "undefined" &&
    error instanceof WebAssembly.LinkError &&
    /shared state of memory/i.test(error.message)
  );
}

export async function initWasm(): Promise<void> {
  if (wasmInitialized) {
    return;
  }

  if (wasmInitPromise) {
    await wasmInitPromise;
    return;
  }

  wasmInitPromise = (async () => {
    wasmLog.info(
      "Starting WASM initialization",
      { parallel: USE_PARALLEL_PROCESSING },
      "running",
    );

    try {
      wasmLog.debug("Importing WASM glue module");
      const glue: any = await import("../../src-wasm/pkg/csv_diff_wasm.js");
      wasmLog.debug("Glue metadata", {
        type: typeof glue,
        keys: Object.keys(glue || {}),
        hasInitSync: !!glue.initSync,
        hasDefault: !!glue.default,
        hasPanicHook: !!glue.init_panic_hook,
      });

      wasmLog.info("SharedArrayBuffer availability", {
        sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
        crossOriginIsolated:
          (globalThis as typeof globalThis & { crossOriginIsolated?: boolean })
            .crossOriginIsolated === true,
      });

      const wasmUrl = new URL(
        "../../src-wasm/pkg/csv_diff_wasm_bg.wasm",
        import.meta.url,
      ).href;
      wasmLog.info("Fetching WASM binary", { wasmUrl });
      const response = await fetch(wasmUrl);
      wasmLog.debug("Fetch status", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch WASM module: ${response.status} ${response.statusText}`,
        );
      }
      const wasmArrayBuffer = await response.arrayBuffer();
      const wasmBytes = new Uint8Array(wasmArrayBuffer);
      wasmLog.success("WASM binary loaded", { byteLength: wasmBytes.length });

      const sharedArrayBufferSupported =
        typeof SharedArrayBuffer !== "undefined" &&
        (globalThis as typeof globalThis & { crossOriginIsolated?: boolean })
          .crossOriginIsolated === true;
      let sharedMemoryInUse = false;
      let memory: WebAssembly.Memory | undefined;

      if (sharedArrayBufferSupported && USE_PARALLEL_PROCESSING) {
        wasmLog.info("Creating SharedArrayBuffer memory", {
          initialPages: 20,
          maxPages: 16384,
        });
        memory = new WebAssembly.Memory({
          initial: 20,
          maximum: 16384,
          shared: true,
        });

        wasmLog.debug("Attempting initSync with shared memory");
        try {
          glue.initSync({ module: wasmBytes, memory });
          sharedMemoryInUse = true;
          wasmLog.success("Shared memory initialization succeeded");
        } catch (error: unknown) {
          if (isSharedMemoryImportMismatch(error)) {
            wasmLog.warn(
              "Shared memory rejected by WASM binary; falling back to unshared memory",
              { error: (error as Error).message },
            );
          } else {
            throw error;
          }
        }
      } else {
        wasmLog.warn(
          "SharedArrayBuffer not available; using single-threaded memory",
        );
      }

      if (!sharedMemoryInUse) {
        wasmLog.info("Initializing WASM with default memory");
        glue.initSync({ module: wasmBytes });
        wasmLog.success("WASM initialized with default memory");
      }

      const resolvedMemory =
        (glue.memory as WebAssembly.Memory | undefined) ?? memory;

      if (!resolvedMemory) {
        throw new Error("WASM memory was not initialized");
      }

      const exportedIsShared =
        resolvedMemory.buffer instanceof SharedArrayBuffer;

      if (sharedMemoryInUse && !exportedIsShared) {
        sharedMemoryInUse = false;
        wasmLog.warn(
          "Exported WASM memory is not shared; disabling parallel execution",
          {
            bufferType: resolvedMemory.buffer.constructor.name,
          },
        );
      }

      wasmModule = glue.default || glue;
      wasmMemory = resolvedMemory;

      try {
        const threadPoolFn =
          (glue as { init_thread_pool?: (threads: number) => Promise<void> })
            .init_thread_pool ||
          (glue as { initThreadPool?: (threads: number) => Promise<void> })
            .initThreadPool;

        const canInitThreadPool =
          USE_PARALLEL_PROCESSING &&
          sharedArrayBufferSupported &&
          sharedMemoryInUse &&
          exportedIsShared &&
          typeof threadPoolFn === "function";

        threadLog.info("Thread pool capability check", {
          hasThreadFn: typeof threadPoolFn === "function",
          sharedArrayBufferSupported,
          sharedMemoryInUse,
          exportedIsShared,
        });

        if (canInitThreadPool) {
          const threads = navigator.hardwareConcurrency || 2;
          threadLog.info("Initializing thread pool", { threads }, "running");
          await threadPoolFn(threads);
          threadLog.success("Thread pool ready", { threads }, "success");
        } else if (USE_PARALLEL_PROCESSING) {
          threadLog.warn("Parallel WASM disabled", {
            sharedArrayBufferSupported,
            sharedMemoryInUse,
            exportedIsShared,
          });
        }
      } catch (e: unknown) {
        threadLog.error("Thread pool initialization failed", {
          message: (e as Error).message,
          stack: (e as Error).stack,
        });
      }

      wasmInitialized = true;
      wasmLog.success("WASM initialization complete", {
        sharedMemoryEnabled: sharedMemoryInUse,
      });
    } catch (error: unknown) {
      wasmLog.error(
        "WASM initialization error",
        error instanceof Error ? error.message : String(error),
        "error",
      );
      throw error;
    } finally {
      wasmInitPromise = null;
    }
  })();

  await wasmInitPromise;
}
