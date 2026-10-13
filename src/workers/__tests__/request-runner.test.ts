import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRequest } from "../request-runner";
import type { RunnerDeps } from "../request-runner";
import type { WorkerResponse } from "../types";

const makeDeps = (overrides: Partial<RunnerDeps> = {}) => {
  const posted: Array<WorkerResponse> = [];
  const deps: RunnerDeps = {
    post: (msg) => posted.push(msg),
    ensureWasm: () => Promise.resolve(),
    handleParse: vi.fn(),
    handleCompare: vi.fn(),
    ...overrides,
  };
  return { deps, posted };
};

describe("runRequest", () => {
  beforeEach(() => {
    // Worker logger posts via self.postMessage, which jsdom's window requires an origin for
    vi.stubGlobal("postMessage", vi.fn());
  });

  it("posts an error response when an async handler rejects", async () => {
    const { deps, posted } = makeDeps({
      handleCompare: () => Promise.reject(new Error("boom")),
    });
    await runRequest({ requestId: 7, type: "compare", data: {} }, deps);
    const err = posted.find((m) => m.type === "compare-error");
    expect(err).toMatchObject({ requestId: 7, data: { message: "boom" } });
  });

  it("posts an error when wasm init fails", async () => {
    const { deps, posted } = makeDeps({
      ensureWasm: () => Promise.reject(new Error("no wasm")),
    });
    await runRequest({ requestId: 1, type: "parse", data: {} }, deps);
    expect(posted.some((m) => m.type === "parse-error")).toBe(true);
  });

  it("reports idle only after the async handler completes", async () => {
    let finish!: () => void;
    const { deps, posted } = makeDeps({
      handleParse: () => new Promise<void>((r) => (finish = r)),
    });
    const run = runRequest({ requestId: 2, type: "parse", data: {} }, deps);
    await Promise.resolve();
    await Promise.resolve();
    const idle = () => posted.some((m) => m.data?.status === "idle");
    expect(idle()).toBe(false);
    finish();
    await run;
    expect(idle()).toBe(true);
  });

  it("routes handler progress and unknown types", async () => {
    const { deps, posted } = makeDeps({
      handleCompare: (_id, _p, _post, emitProgress) => {
        emitProgress(50, "half");
      },
    });
    await runRequest({ requestId: 3, type: "compare", data: {} }, deps);
    expect(posted).toContainEqual({
      requestId: 3,
      type: "progress",
      data: { percent: 50, message: "half" },
    });
    await runRequest({ requestId: 4, type: "nope", data: {} }, deps);
    expect(posted.some((m) => m.type === "nope-error")).toBe(true);
  });
});
