import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCsvWorker } from "../useCsvWorker";

const workers: Array<any> = [];

vi.mock("../../workers/csv.worker?worker", () => ({
  default: class FakeWorker {
    onmessage: any = null;
    onerror: any = null;
    onmessageerror: any = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  },
}));

beforeEach(() => {
  workers.length = 0;
});

describe("useCsvWorker", () => {
  it("rejects all pending requests when the worker errors", async () => {
    const { result } = renderHook(() => useCsvWorker());
    const w = workers[0];
    const p1 = result.current.parse("a,b", "source", true);
    const p2 = result.current.compare(null, null, { sourceRaw: "" });
    const a1 = expect(p1).rejects.toThrow(/Worker crashed: boom/);
    const a2 = expect(p2).rejects.toThrow(/Worker crashed: boom/);
    act(() => w.onerror({ message: "boom" }));
    await a1;
    await a2;
  });

  it("does not forward source/target objects in compare", () => {
    const { result } = renderHook(() => useCsvWorker());
    result.current
      .compare({ big: 1 }, { big: 2 }, { sourceRaw: "x" })
      .catch(() => {}); // rejected on unmount cleanup
    const msg = workers[0].postMessage.mock.calls[0][0];
    expect(msg.type).toBe("compare");
    expect(msg.data).toEqual({ sourceRaw: "x" });
  });

  it("clears the warm-up promise after a failure", async () => {
    const { result } = renderHook(() => useCsvWorker());
    const first = result.current.warmWasm();
    expect(result.current.warmWasm()).toBe(first);
    const assertion = expect(first).rejects.toThrow();
    act(() => workers[0].onerror({ message: "x" }));
    await assertion;
    expect(result.current.warmWasm()).not.toBe(first);
  });

  it("rejects pending requests on unmount", async () => {
    const { result, unmount } = renderHook(() => useCsvWorker());
    const p = expect(result.current.parse("a", "target", true)).rejects.toThrow(
      /Worker terminated/,
    );
    unmount();
    await p;
    expect(workers[0].terminate).toHaveBeenCalled();
  });
});
