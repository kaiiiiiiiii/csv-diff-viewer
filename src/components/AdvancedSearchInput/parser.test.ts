import { describe, expect, it } from "vitest";
import { parseSearchQuery, serializeToken, serializeTokens } from "./parser";

describe("parseSearchQuery", () => {
  it("does not treat words starting with 'or' as the OR operator", () => {
    for (const word of ["order", "orange", "Oregon"]) {
      const tokens = parseSearchQuery(word);
      expect(tokens.length).toBe(1);
      expect(tokens[0].type).toBe("term");
      expect(tokens[0].value).toBe(word);
      expect(tokens[0].operator).toBe("AND");
    }
  });

  it("treats OR as an operator only as a whole word, any case", () => {
    const tokens = parseSearchQuery("order or Oregon");
    expect(tokens.map((t) => t.value)).toEqual(["order", "Oregon"]);
    expect(tokens[1].operator).toBe("OR");
    expect(parseSearchQuery("a Or b")[1].operator).toBe("OR");
  });

  it("parses negated column:value tokens", () => {
    const tokens = parseSearchQuery("-name:john");
    expect(tokens.length).toBe(1);
    expect(tokens[0].type).toBe("column");
    expect(tokens[0].column).toBe("name");
    expect(tokens[0].value).toBe("john");
    expect(tokens[0].negated).toBe(true);
  });

  it("does not mark non-negated column tokens as negated", () => {
    expect(parseSearchQuery("name:john")[0].negated).toBeUndefined();
  });

  it("parses simple space-separated terms", () => {
    const tokens = parseSearchQuery("john doe");
    expect(tokens.length).toBe(2);
    expect(tokens[0].type).toBe("term");
    expect(tokens[0].value).toBe("john");
    expect(tokens[1].value).toBe("doe");
  });

  it("parses exclusion tokens", () => {
    const tokens = parseSearchQuery("-unwanted john");
    expect(tokens.length).toBe(2);
    expect(tokens[0].type).toBe("exclude");
    expect(tokens[0].value).toBe("unwanted");
    expect(tokens[1].type).toBe("term");
  });

  it("parses quoted phrases", () => {
    const tokens = parseSearchQuery('"hello world"');
    expect(tokens.length).toBe(1);
    expect(tokens[0].type).toBe("phrase");
    expect(tokens[0].value).toBe("hello world");
  });

  it("parses column:value tokens", () => {
    const tokens = parseSearchQuery("name:john age:30");
    expect(tokens.length).toBe(2);
    expect(tokens[0].type).toBe("column");
    expect(tokens[0].column).toBe("name");
    expect(tokens[0].value).toBe("john");
    expect(tokens[1].column).toBe("age");
  });

  it("parses OR operator", () => {
    const tokens = parseSearchQuery("john OR jane");
    expect(tokens.length).toBe(2);
    expect(tokens[0].value).toBe("john");
    expect(tokens[1].value).toBe("jane");
    expect(tokens[1].operator).toBe("OR");
  });
});

describe("serialize round-trip", () => {
  const roundTrip = (query: string) =>
    parseSearchQuery(serializeTokens(parseSearchQuery(query)));

  it.each([
    ['"a b"', "quoted phrase"],
    ['-"a b"', "quoted negation"],
    ["-name:john", "negated column"],
    ["name:john age:30", "column-scoped"],
    ["john OR jane", "OR operator"],
    ["OR john -jane", "leading OR"],
    ['john OR -"senior dev" -name:x', "mixed"],
  ])("round-trips %s (%s)", (query) => {
    expect(roundTrip(query)).toEqual(parseSearchQuery(query));
  });

  it("keeps quotes and negation when serialising single tokens", () => {
    const [quoted] = parseSearchQuery('-"a b"');
    expect(serializeToken(quoted)).toBe('-"a b"');
    const [column] = parseSearchQuery("-name:john");
    expect(serializeToken(column)).toBe("-name:john");
  });
});
