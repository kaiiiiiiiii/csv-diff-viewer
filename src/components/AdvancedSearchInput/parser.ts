export interface SearchToken {
  type: "term" | "exclude" | "phrase" | "column";
  value: string;
  column?: string;
  operator?: "AND" | "OR";
  /** Set on column tokens written as `-column:value` */
  negated?: boolean;
}

/**
 * Parse advanced search query into tokens
 * Supports:
 * - Multiple terms (space separated, AND by default)
 * - OR operator: term1 OR term2
 * - Exclusion: -term
 * - Exact phrases: "exact phrase"
 * - Column-specific: column:value (and -column:value)
 */
export function parseSearchQuery(query: string): Array<SearchToken> {
  const tokens: Array<SearchToken> = [];
  let currentPos = 0;
  let currentOperator: "AND" | "OR" = "AND";

  while (currentPos < query.length) {
    // Skip whitespace
    while (currentPos < query.length && /\s/.test(query[currentPos])) {
      currentPos++;
    }

    if (currentPos >= query.length) break;

    // Check for OR operator (whole word only, so "order" or "Oregon" stay terms)
    if (
      query.substring(currentPos, currentPos + 2).toUpperCase() === "OR" &&
      (currentPos + 2 >= query.length || /\s/.test(query[currentPos + 2]))
    ) {
      currentOperator = "OR";
      currentPos += 2;
      continue;
    }

    // Check for exclusion (-)
    const isExclude = query[currentPos] === "-";
    if (isExclude) currentPos++;

    // Check for quoted phrase
    if (query[currentPos] === '"') {
      currentPos++;
      const start = currentPos;
      while (currentPos < query.length && query[currentPos] !== '"') {
        currentPos++;
      }
      const value = query.substring(start, currentPos);
      currentPos++; // skip closing quote
      tokens.push({
        type: isExclude ? "exclude" : "phrase",
        value,
        operator: currentOperator,
      });
      currentOperator = "AND";
      continue;
    }

    // Parse regular term or column:value
    const start = currentPos;
    while (
      currentPos < query.length &&
      !/\s/.test(query[currentPos]) &&
      query[currentPos] !== '"'
    ) {
      currentPos++;
    }
    const term = query.substring(start, currentPos);

    if (!term) continue;

    // Check if it's a column:value pair
    const colonIndex = term.indexOf(":");
    if (colonIndex > 0 && colonIndex < term.length - 1) {
      const column = term.substring(0, colonIndex);
      const value = term.substring(colonIndex + 1);
      tokens.push({
        type: "column",
        value,
        column,
        operator: currentOperator,
        ...(isExclude ? { negated: true } : {}),
      });
    } else {
      tokens.push({
        type: isExclude ? "exclude" : "term",
        value: term,
        operator: currentOperator,
      });
    }
    currentOperator = "AND";
  }

  return tokens;
}

/**
 * Serialise a single token back into query syntax (without its OR operator).
 * Inverse of parseSearchQuery for a single token.
 */
export function serializeToken(token: SearchToken): string {
  switch (token.type) {
    case "phrase":
      return `"${token.value}"`;
    case "exclude":
      // Values with whitespace need quotes to survive re-parsing
      return /\s/.test(token.value) ? `-"${token.value}"` : `-${token.value}`;
    case "column": {
      const term = `${token.column ?? ""}:${token.value}`;
      return token.negated ? `-${term}` : term;
    }
    default:
      return token.value;
  }
}

/**
 * Serialise tokens back into a query string. Tokens with an OR operator are
 * prefixed with `OR `, so parseSearchQuery(serializeTokens(tokens)) yields
 * the same tokens.
 */
export function serializeTokens(tokens: Array<SearchToken>): string {
  return tokens
    .map((token) =>
      token.operator === "OR"
        ? `OR ${serializeToken(token)}`
        : serializeToken(token),
    )
    .join(" ");
}

/** Lowercased per-column values for one row, plus superseded source values */
interface RowContext {
  /** Lowercased values of every column (target values win for modified rows) */
  columns: Record<string, string>;
  /** Lowercased source values that differ from the target value (modified rows only) */
  previous: Record<string, string>;
  /** All searchable text for the row, space-joined */
  allText: string;
}

type RowMatcher = (ctx: RowContext) => boolean;

const toLowerRecord = (obj: Record<string, unknown>) => {
  const out: Record<string, string> = {};
  Object.keys(obj).forEach((key) => {
    out[key] = String(obj[key] ?? "").toLowerCase();
  });
  return out;
};

const buildRowContext = (original: any): RowContext => {
  const columns: Record<string, string> = toLowerRecord(original ?? {});

  // Also check nested values for diff rows (sourceRow, targetRow, row)
  if (original?.sourceRow)
    Object.assign(columns, toLowerRecord(original.sourceRow));
  if (original?.targetRow)
    Object.assign(columns, toLowerRecord(original.targetRow));
  if (original?.row) Object.assign(columns, toLowerRecord(original.row));

  // Modified rows: the source (old) value is overwritten by the target (new)
  // value above, so keep any old value that differs so it stays searchable
  const previous: Record<string, string> = {};
  if (original?.sourceRow && original?.targetRow) {
    const oldValues = toLowerRecord(original.sourceRow);
    Object.keys(oldValues).forEach((key) => {
      if (oldValues[key] !== columns[key]) previous[key] = oldValues[key];
    });
  }

  const allText = [...Object.values(columns), ...Object.values(previous)].join(
    " ",
  );
  return { columns, previous, allText };
};

const compileToken = (token: SearchToken): RowMatcher => {
  const needle = token.value.toLowerCase();

  let matches: RowMatcher;
  if (token.type === "column" && token.column) {
    const column = token.column;
    matches = (ctx) =>
      (ctx.columns[column] ?? "").includes(needle) ||
      (ctx.previous[column] ?? "").includes(needle);
  } else {
    matches = (ctx) => ctx.allText.includes(needle);
  }

  const negate = token.type === "exclude" || token.negated === true;
  return negate ? (ctx) => !matches(ctx) : matches;
};

/**
 * Create a custom filter function that handles advanced search tokens
 */
export function createAdvancedFilterFn(tokens: Array<SearchToken>) {
  // Group contiguous tokens separated by OR into separate groups.
  // - Each group is an AND of its tokens
  // - Final result is OR across groups
  const groups: Array<Array<RowMatcher>> = [];
  const groupTokens: Array<Array<SearchToken>> = [];
  tokens.forEach((token, i) => {
    if (i === 0 || token.operator === "OR") {
      groupTokens.push([token]);
    } else {
      groupTokens[groupTokens.length - 1].push(token);
    }
  });
  groupTokens.forEach((group) => groups.push(group.map(compileToken)));

  // columnId and filterValue are required by TanStack Table's FilterFn interface but not used
  // since we search across all columns based on the parsed tokens
  return (row: any, _columnId: string, _filterValue: any): boolean => {
    if (groups.length === 0) return true;

    const ctx = buildRowContext(row.original);
    return groups.some((group) => group.every((matches) => matches(ctx)));
  };
}

export default { parseSearchQuery, createAdvancedFilterFn };
