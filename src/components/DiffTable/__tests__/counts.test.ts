import { describe, expect, it } from "vitest";
import { countDiffTypes } from "../counts";

describe("countDiffTypes", () => {
  const results = {
    added: [1, 2],
    removed: [1],
    modified: [1, 2, 3],
    unchanged: [1, 2, 3, 4],
  };

  it("counts every type from the unfiltered results", () => {
    expect(countDiffTypes(results)).toEqual({
      added: 2,
      removed: 1,
      modified: 3,
      unchanged: 4,
    });
  });

  it("reports no unchanged rows when only diffs are shown", () => {
    expect(countDiffTypes(results, true).unchanged).toBe(0);
  });
});
