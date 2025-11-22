import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./parser";

describe("parseSearchQuery", () => {
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
