export interface SearchToken {
  type: "term" | "exclude" | "phrase" | "column";
  value: string;
  column?: string;
  operator?: "AND" | "OR";
}

/**
 * Parse advanced search query into tokens
 * Supports:
 * - Multiple terms (space separated, AND by default)
 * - OR operator: term1 OR term2
 * - Exclusion: -term
 * - Exact phrases: "exact phrase"
 * - Column-specific: column:value
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

    // Check for OR operator
    if (query.substring(currentPos, currentPos + 2).toUpperCase() === "OR") {
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
 * Create a custom filter function that handles advanced search tokens
 */
export function createAdvancedFilterFn(tokens: Array<SearchToken>) {
  // columnId and filterValue are required by TanStack Table's FilterFn interface but not used
  // since we search across all columns based on the parsed tokens
  return (row: any, _columnId: string, _filterValue: any): boolean => {
    if (tokens.length === 0) return true;

    // Helper to extract and normalize values from an object
    const rowValues: Record<string, string> = {};
    const extractValues = (obj: any) => {
      Object.keys(obj).forEach((key) => {
        const val = obj[key];
        rowValues[key] = String(val ?? "").toLowerCase();
      });
    };

    // Get all cell values from the row (including nested values for diff rows)
    extractValues(row.original);

    // Also check nested values for diff rows (sourceRow, targetRow, row)
    if (row.original?.sourceRow) extractValues(row.original.sourceRow);
    if (row.original?.targetRow) extractValues(row.original.targetRow);
    if (row.original?.row) extractValues(row.original.row);

    const allText = Object.values(rowValues).join(" ");

    // Group contiguous tokens separated by OR into separate groups.
    // A token with operator "OR" indicates it is connected to the previous token by OR,
    // which effectively splits groups. We'll collect groups and evaluate:
    // - Each group is an AND of its tokens
    // - Final result is OR across groups
    if (tokens.length === 0) return true;

    const groups: Array<Array<SearchToken>> = [];
    groups.push([tokens[0]]);

    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.operator === "OR") {
        // Start a new group when token is connected by OR
        groups.push([token]);
      } else {
        // Continue the current group (AND)
        groups[groups.length - 1].push(token);
      }
    }

    const evaluateTokenMatch = (token: SearchToken) => {
      const searchValue = token.value.toLowerCase();
      if (token.type === "column" && token.column) {
        const columnValue = rowValues[token.column] ?? "";
        return columnValue.includes(searchValue);
      }
      if (token.type === "phrase") {
        return allText.includes(searchValue);
      }
      if (token.type === "exclude") {
        return !allText.includes(searchValue);
      }
      return allText.includes(searchValue);
    };

    for (const group of groups) {
      const groupResult = group.every((t) => evaluateTokenMatch(t));
      if (groupResult) return true; // OR across groups
    }

    return false;
  };
}

export default { parseSearchQuery, createAdvancedFilterFn };
