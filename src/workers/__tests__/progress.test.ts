import { describe, expect, it, vi } from "vitest";
import {
  countRows,
  isDuplicateKeyError,
  parseThreadProgress,
  throttleProgress,
} from "../progress";

describe("parseThreadProgress", () => {
  it("parses the legacy format", () => {
    expect(parseThreadProgress("THREAD_PROGRESS|2|50|125")).toEqual({
      threadId: 2,
      processed: 50,
      perThreadTotal: 125,
    });
  });

  it("parses the JSON format with global progress", () => {
    const msg =
      'THREAD_PROGRESS_JSON|{"threadId":1,"processed":5,"perThreadTotal":10,"globalProgress":75}';
    expect(parseThreadProgress(msg)).toEqual({
      threadId: 1,
      processed: 5,
      perThreadTotal: 10,
      globalProgress: 75,
    });
  });

  it("returns null for other, malformed or non-string messages", () => {
    expect(parseThreadProgress("Parsing...")).toBeNull();
    expect(parseThreadProgress("THREAD_PROGRESS|x|1|2")).toBeNull();
    expect(parseThreadProgress("THREAD_PROGRESS|1|2")).toBeNull();
    expect(parseThreadProgress("THREAD_PROGRESS_JSON|{oops")).toBeNull();
    expect(parseThreadProgress("THREAD_PROGRESS_JSON|{}")).toBeNull();
    expect(parseThreadProgress(42)).toBeNull();
  });
});

describe("countRows", () => {
  it("counts rows excluding the header", () => {
    expect(countRows("a,b\n1,2\n3,4", true)).toBe(2);
    expect(countRows("a,b\n1,2\n3,4", false)).toBe(3);
  });

  it("handles \\r\\n and a trailing newline", () => {
    expect(countRows("a,b\r\n1,2\r\n3,4\r\n", true)).toBe(2);
    expect(countRows("a\n1\n", true)).toBe(1);
  });

  it("handles empty input", () => {
    expect(countRows("", true)).toBe(0);
    expect(countRows("", false)).toBe(0);
    expect(countRows("header", true)).toBe(0);
  });
});

describe("throttleProgress", () => {
  it("drops updates inside the interval but always passes 100%", () => {
    let t = 0;
    const emit = vi.fn();
    const throttled = throttleProgress(emit, 50, () => t);
    throttled(0, "start");
    t = 10;
    throttled(10, "skipped");
    t = 60;
    throttled(20, "kept");
    t = 61;
    throttled(100, "done");
    expect(emit.mock.calls.map((c) => c[0])).toEqual([0, 20, 100]);
  });
});

describe("isDuplicateKeyError", () => {
  it("matches duplicate primary key errors only", () => {
    expect(
      isDuplicateKeyError(
        new Error('Duplicate Primary Key found in source: "1".'),
      ),
    ).toBe(true);
    expect(isDuplicateKeyError("thread pool exploded")).toBe(false);
  });
});
