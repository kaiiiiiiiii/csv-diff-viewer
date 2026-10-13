const GENERATED_HEADER = /^Column\d+$/;

/** True when every header matches the generated `ColumnN` pattern. */
export const hasGeneratedHeaders = (headers: ReadonlyArray<string>) =>
  headers.length > 0 && headers.every((h) => GENERATED_HEADER.test(h));

/**
 * Columns offered for key/exclusion selection: those present in both files,
 * in source order. Falls back to the source headers while no target is loaded.
 */
export const computeAvailableColumns = (
  sourceHeaders: ReadonlyArray<string> | null,
  targetHeaders: ReadonlyArray<string> | null,
): Array<string> => {
  if (!sourceHeaders) return targetHeaders ? [...targetHeaders] : [];
  if (!targetHeaders) return [...sourceHeaders];
  const inTarget = new Set(targetHeaders);
  return sourceHeaders.filter((h) => inTarget.has(h));
};

export interface CompareRunOptions {
  comparisonMode: "primary-key" | "content-match";
  keyColumns: Array<string>;
}

/**
 * The binary compare result carries only the diff rows; fill in the metadata
 * the UI needs from the options the comparison was actually run with.
 */
export const mergeCompareResult = (
  result: any,
  options: CompareRunOptions,
  sourceHeaders: Array<string>,
  targetHeaders: Array<string>,
) => ({
  added: result?.added ?? [],
  removed: result?.removed ?? [],
  modified: result?.modified ?? [],
  unchanged: result?.unchanged ?? [],
  source: {
    headers: result?.source?.headers ?? sourceHeaders,
    rows: result?.source?.rows ?? [],
  },
  target: {
    headers: result?.target?.headers ?? targetHeaders,
    rows: result?.target?.rows ?? [],
  },
  keyColumns:
    options.comparisonMode === "primary-key" ? options.keyColumns : [],
  excludedColumns: result?.excludedColumns ?? [],
  mode: options.comparisonMode,
});
