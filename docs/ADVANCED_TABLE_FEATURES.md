# Advanced Table Features

This document describes the advanced table features added to the CSV Diff Viewer's DiffTable component.

## Overview

The DiffTable component now includes three major advanced features:

1. **Column Visibility Toggle** - Hide or show specific columns
2. **Per-Column Filtering** - Filter individual columns independently
3. **Session Persistence** - Column visibility preferences persist across sessions

These features enhance usability when working with large or complex CSV files by allowing users to focus on relevant data.

## Features

### 1. Column Visibility Toggle

Users can now hide or show any column in the diff table through a dropdown menu.

**UI Location**: Top-right toolbar, "Columns" button with a column icon

**Behavior**:

- Click the "Columns" button to open a dropdown menu
- Each column has a checkbox that can be toggled on/off
- Hidden columns are immediately removed from the table view
- Column visibility state is saved to localStorage and persists across browser sessions
- All columns can be hidden except when at least one is needed for context

**Storage Key**: `csv-diff-viewer-column-visibility`

**Implementation Details**:

```typescript
// State management
const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

// Column definition
{
  id: 'column_name',
  enableHiding: true,  // Allows column to be hidden
  // ... other column config
}

// Table configuration
const table = useReactTable({
  state: {
    columnVisibility,
  },
  onColumnVisibilityChange: setColumnVisibility,
  // ... other config
})
```

### 2. Per-Column Filtering

Users can filter each column individually using text-based filters.

**UI Location**: Below the table header row when "Column Filters" is toggled on

**Behavior**:

- Click the "Column Filters" button to show/hide the filter row
- Each visible column gets its own filter input
- Type text to filter rows based on that column's values
- Filters use case-insensitive substring matching by default
- Multiple column filters can be active simultaneously
- Clear individual filters using the "X" button next to each input
- Filters work in combination with the global search filter

**Filter Types**:

- **Text columns**: Uses `includesString` filter function (case-insensitive substring match)
- **Type column**: Uses `equalsString` filter function (exact match)

**Implementation Details**:

```typescript
// State management
const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
const [showColumnFilters, setShowColumnFilters] = useState(false)

// Column definition
{
  id: 'column_name',
  enableColumnFilter: true,  // Enables filtering for this column
  filterFn: 'includesString',  // Built-in TanStack Table filter
  // ... other column config
}

// Table configuration
const table = useReactTable({
  state: {
    columnFilters,
  },
  onColumnFiltersChange: setColumnFilters,
  getFilteredRowModel: getFilteredRowModel(),
  // ... other config
})
```

### 3. Session Persistence

Column visibility preferences are automatically saved to localStorage and restored when the page reloads.

**Implementation**:

```typescript
const STORAGE_KEY = 'csv-diff-viewer-column-visibility'

// Load on mount
useEffect(() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      setColumnVisibility(JSON.parse(stored))
    }
  } catch (error) {
    console.error('Failed to load column visibility from localStorage:', error)
  }
}, [])

// Save on change
useEffect(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columnVisibility))
  } catch (error) {
    console.error('Failed to save column visibility to localStorage:', error)
  }
}, [columnVisibility])
```

## Existing Features (Enhanced)

These features were already present and work seamlessly with the new additions:

### Sorting

- Click any column header to sort by that column
- Click again to reverse the sort order
- Sort indicator shows current sort direction
- Works with filtered data

### Global Filter

- Text input at the top-left filters across all columns
- Searches all visible cells for the entered text
- Works in combination with per-column filters

### Type Filtering

- Badge buttons filter by change type: All, Added, Removed, Modified
- Shows count of rows for each type
- Disabled if no rows of that type exist

## UI Components Added

### New Components Created

1. **dropdown-menu.tsx** (`src/components/ui/dropdown-menu.tsx`)
   - Radix UI-based dropdown menu component
   - Used for the column visibility dropdown
   - Supports checkbox items, labels, separators

2. **checkbox.tsx** (`src/components/ui/checkbox.tsx`)
   - Radix UI-based checkbox component
   - Used within the dropdown menu for column toggles

### New Dependencies

Added to `package.json`:

- `@radix-ui/react-dropdown-menu` - Dropdown menu primitive
- `@radix-ui/react-checkbox` - Checkbox primitive

## Usage Examples

### Hiding Columns

1. Click the "Columns" button in the top-right toolbar
2. Uncheck any columns you want to hide
3. Columns are immediately hidden from view
4. Reopen the menu and check them again to show them

### Filtering Columns

1. Click the "Column Filters" button to show the filter row
2. Type in any column's filter input to filter by that column
3. Use the "X" button to clear a column filter
4. Click "Column Filters" again to hide the filter row

### Combining Features

Users can combine all filtering and visibility features:

1. Hide irrelevant columns using the "Columns" dropdown
2. Filter by change type using the badge buttons (Added/Removed/Modified)
3. Use the global filter for quick cross-column searches
4. Enable column filters for precise per-column filtering
5. Sort any visible column by clicking its header

## Technical Notes

### TanStack Table v8 Integration

All features use TanStack Table v8's built-in APIs:

- `columnVisibility` state for hiding/showing columns
- `columnFilters` state for per-column filtering
- `getFilteredRowModel()` for applying filters
- `column.getIsVisible()` to check visibility
- `column.toggleVisibility()` to toggle columns
- `column.getFilterValue()` and `column.setFilterValue()` for filters

### Performance Considerations

- Column visibility changes are instant (no re-computation needed)
- Filtering uses optimized TanStack Table filter functions
- Virtualization (via `@tanstack/react-virtual`) handles large datasets
- localStorage operations are wrapped in try-catch to handle quota errors

### Browser Compatibility

- Uses localStorage (available in all modern browsers)
- Falls back gracefully if localStorage is unavailable
- Radix UI components are accessible and keyboard-navigable
- Works with screen readers

## Future Enhancements

Potential improvements for future iterations:

- Column reordering (drag-and-drop)
- Column resizing
- Filter presets (save/load filter combinations)
- Export visible/filtered data
- Advanced filter types (regex, numeric ranges, date ranges)
- Column grouping
- Pinned columns (freeze columns on scroll)

## Related Files

- `src/components/DiffTable.tsx` - Main table component
- `src/components/ui/dropdown-menu.tsx` - Dropdown menu UI component
- `src/components/ui/checkbox.tsx` - Checkbox UI component
- `package.json` - Dependencies
