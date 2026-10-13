export interface DiffCounts {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

/** Count rows per diff type; callers pass unfiltered rows so badges stay stable while searching. */
export function countDiffTypes(
  results: { [K in keyof DiffCounts]: Array<unknown> },
  showOnlyDiffs = false,
): DiffCounts {
  return {
    added: results.added.length,
    removed: results.removed.length,
    modified: results.modified.length,
    unchanged: showOnlyDiffs ? 0 : results.unchanged.length,
  };
}
