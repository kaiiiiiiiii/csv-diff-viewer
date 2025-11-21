# Advanced Search Feature

## Overview

The advanced search input replaces the simple global filter with a powerful search syntax that supports multiple search operators, similar to Google search. This allows users to construct complex queries to filter CSV diff results.

## Features

### Multiple Search Terms (AND Logic)

Search for rows containing all terms:

```
john developer
```

Matches rows that contain both "john" AND "developer"

### OR Operator

Search for rows containing any of the terms:

```
john OR jane
```

Matches rows that contain either "john" OR "jane"

### Exclusion (Negative Search)

Exclude rows containing specific terms:

```
-manager
```

Matches rows that do NOT contain "manager"

### Exact Phrase Match

Search for exact phrases using quotes:

```
"senior developer"
```

Matches rows that contain the exact phrase "senior developer"

### Column-Specific Search

Search within a specific column:

```
name:john
department:engineering
```

Matches rows where the "name" column contains "john" or "department" contains "engineering"

### Combined Queries

Combine multiple operators for powerful filtering:

```
john OR jane -manager "senior developer" department:engineering
```

This matches rows that:

- Contain "john" OR "jane"
- Do NOT contain "manager"
- Contain the exact phrase "senior developer"
- Have "engineering" in the department column

## UI Components

### Search Input

- Main text input field with placeholder showing example syntax
- Clear button (X) appears when text is entered
- Help button (?) shows syntax guide in a dropdown

### Search Tokens Display

When a query is entered, visual badges appear below the input showing parsed search terms:

- **Regular terms**: Gray badges
- **Excluded terms**: Red badges with "-" prefix
- **Exact phrases**: Blue badges with quotes
- **Column-specific**: Purple badges with "column:" prefix
- **OR operator**: Shows "OR" between terms

Each badge can be clicked to remove that term from the search.

### Help Dropdown

Click the help icon (?) to see a comprehensive syntax guide with:

- Multiple terms (AND) example
- OR operator example
- Exclude term example
- Exact phrase example
- Column-specific example
- Combined example

## Implementation Details

### Search Query Parsing

The `parseSearchQuery()` function tokenizes the search string into structured tokens:

```typescript
interface SearchToken {
  type: 'term' | 'exclude' | 'phrase' | 'column'
  value: string
  column?: string
  operator?: 'AND' | 'OR'
}
```

### Filter Function

The `createAdvancedFilterFn()` function creates a custom TanStack Table filter that:

1. Extracts all cell values from the row (including nested sourceRow, targetRow, row objects)
2. Converts all values to lowercase for case-insensitive matching
3. Evaluates each search token against the row data
4. Handles AND/OR logic between tokens
5. Returns true if the row matches all conditions

### Integration with TanStack Table

The advanced search integrates with TanStack Table's global filter:

```typescript
const globalFilterFn = useMemo(() => {
  const tokens = parseSearchQuery(globalFilter)
  return createAdvancedFilterFn(tokens)
}, [globalFilter])

const table = useReactTable({
  // ... other config
  globalFilterFn,
})
```

## Usage Examples

### Find All Developers or Designers

```
developer OR designer
```

### Find John or Jane, Excluding Managers

```
john OR jane -manager
```

### Find Senior Developers in Engineering

```
"senior developer" department:engineering
```

### Complex Query

```
name:john OR name:jane -intern role:developer OR role:engineer
```

This finds rows where:

- The name is "john" OR "jane"
- Does NOT contain "intern"
- Role is "developer" OR "engineer"

## Performance Considerations

- Parsing is done only when the search query changes (via `useMemo`)
- Filter function is optimized for substring matching
- Works seamlessly with TanStack Table's virtual scrolling
- No impact on existing column filters or type badges

## Browser Compatibility

- Uses standard JavaScript string methods
- No external dependencies beyond existing project libraries
- Accessible via keyboard navigation
- Works with screen readers

## Differences from Simple Search

The previous simple search only supported basic substring matching across all columns. The advanced search adds:

1. **Multiple terms with AND logic** (space-separated)
2. **OR operator** for alternative matches
3. **Exclusion** with `-` prefix
4. **Exact phrases** with quotes
5. **Column-specific search** with `column:value` syntax
6. **Visual token display** for better query understanding
7. **Inline help** for syntax reference

## Testing

The advanced search can be tested with the example data:

1. Load example data
2. Click "Compare Files"
3. Try these queries in the search input:
   - `john` - Find all rows with "john"
   - `john OR jane` - Find rows with either name
   - `developer -senior` - Find developers excluding senior
   - `"team lead"` - Find exact phrase
   - `name:john department:engineering` - Column-specific search

## Future Enhancements

Potential improvements:

- Regular expression support: `/pattern/`
- Numeric comparisons: `id:>5`, `id:<10`
- Date range filters: `date:2024-01-01..2024-12-31`
- Save/load search presets
- Search history
- Auto-complete for column names
- Fuzzy matching options
