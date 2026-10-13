import { describe, expect, it } from "vitest";
import {
  computeAvailableColumns,
  hasGeneratedHeaders,
  mergeCompareResult,
} from "@/lib/route-helpers";

describe("hasGeneratedHeaders", () => {
  it("detects fully generated headers", () => {
    expect(hasGeneratedHeaders(["Column1", "Column2"])).toBe(true);
  });
  it("ignores real headers that merely start with Column", () => {
    expect(hasGeneratedHeaders(["id", "Column_name"])).toBe(false);
    expect(hasGeneratedHeaders(["Column1", "name"])).toBe(false);
    expect(hasGeneratedHeaders([])).toBe(false);
  });
});

describe("computeAvailableColumns", () => {
  it("uses source when no target", () => {
    expect(computeAvailableColumns(["a", "b"], null)).toEqual(["a", "b"]);
  });
  it("intersects in source order", () => {
    expect(computeAvailableColumns(["a", "b", "c"], ["c", "a", "x"])).toEqual([
      "a",
      "c",
    ]);
  });
  it("handles nothing loaded", () => {
    expect(computeAvailableColumns(null, null)).toEqual([]);
  });
});

describe("mergeCompareResult", () => {
  it("reports primary-key mode and key columns", () => {
    const r = mergeCompareResult(
      { added: [1] },
      { comparisonMode: "primary-key", keyColumns: ["id"] },
      ["id", "n"],
      ["id", "n"],
    );
    expect(r.mode).toBe("primary-key");
    expect(r.keyColumns).toEqual(["id"]);
    expect(r.source.headers).toEqual(["id", "n"]);
    expect(r.added).toEqual([1]);
    expect(r.removed).toEqual([]);
  });
  it("content-match has no key columns", () => {
    const r = mergeCompareResult(
      null,
      { comparisonMode: "content-match", keyColumns: ["id"] },
      [],
      [],
    );
    expect(r.mode).toBe("content-match");
    expect(r.keyColumns).toEqual([]);
  });
});
