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

  it("negates column search with -column:value", () => {
    const fn = createAdvancedFilterFn(parseSearchQuery("-name:john"));
    expect(fn(makeRow({ name: "john", role: "dev" }), "", null)).toBe(false);
    expect(fn(makeRow({ name: "jane", role: "dev" }), "", null)).toBe(true);
  });

  it("does not match 'or' inside words", () => {
    const fn = createAdvancedFilterFn(parseSearchQuery("order"));
    expect(fn(makeRow({ v: "shipping order" }), "", null)).toBe(true);
    expect(fn(makeRow({ v: "orange" }), "", null)).toBe(false);
  });

  describe("modified rows", () => {
    const modified = {
      original: {
        key: "1",
        type: "modified",
        sourceRow: { name: "john", city: "berlin" },
        targetRow: { name: "jane", city: "berlin" },
      },
    };
    const fnFor = (query: string) =>
      createAdvancedFilterFn(parseSearchQuery(query));

    it("matches the old (source) value in free text", () => {
      expect(fnFor("john")(modified, "", null)).toBe(true);
    });

    it("matches the new (target) value in free text", () => {
      expect(fnFor("jane")(modified, "", null)).toBe(true);
    });

    it("matches either old or new value with column scope", () => {
      expect(fnFor("name:john")(modified, "", null)).toBe(true);
      expect(fnFor("name:jane")(modified, "", null)).toBe(true);
      expect(fnFor("name:bob")(modified, "", null)).toBe(false);
    });

    it("excludes rows by old value with -column:value", () => {
      expect(fnFor("-name:john")(modified, "", null)).toBe(false);
    });
  });
});
