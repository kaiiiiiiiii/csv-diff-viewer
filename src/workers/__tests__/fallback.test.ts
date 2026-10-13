import { describe, expect, it } from "vitest";
import { shouldFallbackToSequential, toFatalError } from "../fallback";

describe("shouldFallbackToSequential", () => {
  it("does not retry Rust string errors", () => {
    expect(shouldFallbackToSequential("Key column not found")).toBe(false);
  });
  it("does not retry duplicate key errors", () => {
    expect(
      shouldFallbackToSequential(new Error("Duplicate primary key: 1")),
    ).toBe(false);
  });
  it("does not retry WebAssembly traps", () => {
    expect(shouldFallbackToSequential(new WebAssembly.RuntimeError("x"))).toBe(
      false,
    );
  });
  it("retries generic errors and TypeErrors", () => {
    expect(shouldFallbackToSequential(new Error("pool failed"))).toBe(true);
    expect(shouldFallbackToSequential(new TypeError("SharedArrayBuffer"))).toBe(
      true,
    );
  });
});

describe("toFatalError", () => {
  it("wraps strings and traps", () => {
    expect(toFatalError("bad").message).toBe("bad");
    expect(toFatalError(new WebAssembly.RuntimeError("oob")).message).toMatch(
      /reload/,
    );
  });
});
