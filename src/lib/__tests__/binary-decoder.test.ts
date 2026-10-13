import { describe, expect, it } from "vitest";
import { BinaryDecoder } from "../binary-decoder";

// Mirrors src-wasm/src/binary_encoder.rs: LE u32s, length-prefixed UTF-8.
class Builder {
  bytes: Array<number> = [];
  u8(v: number) {
    this.bytes.push(v);
    return this;
  }
  u32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.bytes.push(...b);
    return this;
  }
  str(s: string) {
    const enc = new TextEncoder().encode(s);
    this.u32(enc.length);
    this.bytes.push(...enc);
    return this;
  }
  row(r: Record<string, string>) {
    this.u32(Object.keys(r).length);
    for (const [k, v] of Object.entries(r)) this.str(k).str(v);
    return this;
  }
  build() {
    return new Uint8Array(this.bytes);
  }
}

describe("BinaryDecoder", () => {
  it("decodes all row types, non-ASCII strings and repeated columns", () => {
    const b = new Builder()
      .u32(4)
      .u32(1)
      .u32(1)
      .u32(1)
      .u32(1)
      .u8(1)
      .str("k1")
      .row({ id: "k1", name: "Zoë 日本" })
      .u8(2)
      .str("k2")
      .row({ id: "k2", name: "b" })
      .u8(3)
      .str("k3")
      .row({ id: "k3", name: "old" })
      .row({ id: "k3", name: "new" })
      .u32(1)
      .str("name")
      .str("old")
      .str("new")
      .u8(4)
      .str("k4")
      .row({ id: "k4", name: "" });

    const res = new BinaryDecoder(b.build()).decode();
    expect(res.added).toEqual([
      { key: "k1", targetRow: { id: "k1", name: "Zoë 日本" } },
    ]);
    expect(res.removed[0].sourceRow).toEqual({ id: "k2", name: "b" });
    expect(res.modified[0].differences).toEqual([
      { column: "name", oldValue: "old", newValue: "new" },
    ]);
    expect(res.unchanged[0].row.name).toBe("");
  });

  it("decodes an empty result", () => {
    const buf = new Builder().u32(0).u32(0).u32(0).u32(0).u32(0).build();
    expect(new BinaryDecoder(buf).decode()).toEqual({
      added: [],
      removed: [],
      modified: [],
      unchanged: [],
    });
  });

  it("works on an offset view and throws on truncated input", () => {
    const inner = new Builder().u32(0).u32(0).u32(0).u32(0).u32(0).build();
    const padded = new Uint8Array(inner.length + 3);
    padded.set(inner, 3);
    expect(() => new BinaryDecoder(padded.subarray(3)).decode()).not.toThrow();
    expect(() => new BinaryDecoder(inner.subarray(0, 10)).decode()).toThrow(
      /overflow/,
    );
  });
});
