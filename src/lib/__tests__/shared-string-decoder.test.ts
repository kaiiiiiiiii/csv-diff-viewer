import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedStringDecoder } from "../shared-string-decoder";

const text = "héllo 日本 ✓";
const enc = new TextEncoder().encode(text);

afterEach(() => vi.unstubAllGlobals());

describe("SharedStringDecoder", () => {
  it("decodes regular views (including offset subarrays)", () => {
    const padded = new Uint8Array(enc.length + 4);
    padded.set(enc, 2);
    expect(SharedStringDecoder.decode(padded.subarray(2, 2 + enc.length))).toBe(
      text,
    );
    expect(SharedStringDecoder.decode(new Uint8Array(0))).toBe("");
  });

  it.skipIf(typeof SharedArrayBuffer === "undefined")(
    "decodes SharedArrayBuffer-backed views",
    () => {
      const sab = new SharedArrayBuffer(enc.length);
      new Uint8Array(sab).set(enc);
      const view = new Uint8Array(sab);
      expect(SharedStringDecoder.decode(view)).toBe(text);
      expect(SharedStringDecoder.decodeFromSharedChunked(view, 3)).toBe(text);
    },
  );

  it("works when SharedArrayBuffer is undefined", () => {
    vi.stubGlobal("SharedArrayBuffer", undefined);
    expect(SharedStringDecoder.decode(enc)).toBe(text);
    expect(SharedStringDecoder.decodeFromSharedChunked(enc)).toBe(text);
  });
});
