import { describe, expect, it } from "vitest";
import { createAdvancedFilterFn, parseSearchQuery } from "./parser";

describe("createAdvancedFilterFn", () => {
  const makeRow = (values: Record<string, string>) => ({ original: values });

  it("matches single token", () => {
    const tokens = parseSearchQuery("john");
    const fn = createAdvancedFilterFn(tokens);
    expect(fn(makeRow({ name: "john" }), "", null)).toBe(true);
    expect(fn(makeRow({ name: "jane" }), "", null)).toBe(false);
  });

  it("supports exclusion tokens", () => {
    const tokens = parseSearchQuery("-manager");
    const fn = createAdvancedFilterFn(tokens);
    expect(fn(makeRow({ name: "john", role: "manager" }), "", null)).toBe(
      false,
    );
    expect(fn(makeRow({ name: "john", role: "developer" }), "", null)).toBe(
      true,
    );
  });

  it("handles OR operator", () => {
    const tokens = parseSearchQuery("john OR jane");
    const fn = createAdvancedFilterFn(tokens);
    expect(fn(makeRow({ name: "john" }), "", null)).toBe(true);
    expect(fn(makeRow({ name: "jane" }), "", null)).toBe(true);
    expect(fn(makeRow({ name: "other" }), "", null)).toBe(false);
  });

  it("handles AND and OR mixed grouping", () => {
    // a b OR c d => (a AND b) OR (c AND d)
    const tokens = parseSearchQuery("a b OR c d");
    const fn = createAdvancedFilterFn(tokens);
    expect(fn(makeRow({ v: "a b" }), "", null)).toBe(true); // both tokens are present in a single field
    expect(fn(makeRow({ v: "a", other: "b" }), "", null)).toBe(true); // a AND b present
    expect(fn(makeRow({ v: "c", other: "d" }), "", null)).toBe(true);
  });

  it("supports column search", () => {
    const tokens = parseSearchQuery("name:john");
    const fn = createAdvancedFilterFn(tokens);
    expect(fn(makeRow({ name: "john", role: "dev" }), "", null)).toBe(true);
    expect(fn(makeRow({ name: "jane", role: "dev" }), "", null)).toBe(false);
  });
});
