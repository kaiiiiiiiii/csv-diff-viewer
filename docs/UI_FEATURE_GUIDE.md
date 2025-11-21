# UI Feature Guide - Advanced Table Options

## Overview

This guide documents the new UI elements added to the DiffTable component for advanced table interactions.

## New UI Elements

### 1. Column Filters Toggle Button

**Location**: Top toolbar, between the change type badges and the "Columns" button

**Appearance**:

```
[Filter Icon] Column Filters
```

**Functionality**:

- Toggles the visibility of the column filter row
- When active, displays filter input boxes below each column header
- Button style: Outlined, small size (h-8)

**Code Location**: `src/components/DiffTable.tsx`, in the toolbar section (right-side controls)

### 2. Columns Dropdown Menu

**Location**: Top-right toolbar, next to the expand/fullscreen buttons

**Appearance**:

```
[Columns Icon] Columns ▼
```

**Functionality**:

- Opens a dropdown menu with checkboxes for each column
- Allows users to show/hide individual columns
- Displays "Toggle Columns" header
- Each column name appears with a checkbox
- Checked = visible, unchecked = hidden
- Button style: Outlined, small size (h-8)

**Menu Structure**:

```
Toggle Columns
─────────────
☑ Type
☑ id
☑ name
☑ role
☑ department
```

**Code Location**: `src/components/DiffTable.tsx`, in the toolbar section (DropdownMenu component)

### 3. Column Filter Row

**Location**: Below the table header row, above the data rows

**Appearance**: A row with filter input boxes for each visible column

**Structure**:

```
┌────────┬──────────┬──────────┬──────────┬──────────┐
│ Type   │ id       │ name     │ role     │ dept     │ (Headers)
├────────┼──────────┼──────────┼──────────┼──────────┤
│[Filter]│[Filter..]│[Filter..]│[Filter..]│[Filter..]│ (Filter Row)
├────────┼──────────┼──────────┼──────────┼──────────┤
│ added  │ 1        │ John Doe │ Dev      │ Eng      │ (Data)
└────────┴──────────┴──────────┴──────────┴──────────┘
```

**Features**:

- Small text input (h-8, text-xs) for each column
- Placeholder text: "Filter..."
- Clear button (X icon) appears when text is entered
- Light background (bg-muted/30) to distinguish from data rows
- Only visible when "Column Filters" button is toggled on

**Code Location**: `src/components/DiffTable.tsx`, in the thead section (conditional filter row)

## Complete Toolbar Layout

The toolbar now has the following structure:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Global Filter Input]  [All] [Added] [Removed] [Modified]              │
│                                                                          │
│                          [n rows found]  [Column Filters] [Columns ▼]  │
│                                          [Expand] [Fullscreen]          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Left Section**:

- Global filter input (existing)
- Change type badges (existing)

**Right Section**:

- Row count display (existing)
- **NEW**: Column Filters toggle button
- **NEW**: Columns dropdown menu
- Expand width button (existing)
- Fullscreen button (existing)

## User Workflows

### Workflow 1: Hide Irrelevant Columns

1. User clicks "Columns" button
2. Dropdown menu appears with all columns listed
3. User unchecks columns they don't need (e.g., "id" column)
4. Column immediately disappears from table
5. Preference is saved to localStorage
6. On next visit, hidden columns remain hidden

### Workflow 2: Filter Specific Column

1. User clicks "Column Filters" button
2. Filter row appears below headers
3. User types "Engineer" in the "department" column filter
4. Table instantly filters to show only rows where department contains "Engineer"
5. User can add filters to other columns simultaneously
6. Click X button to clear individual column filter

### Workflow 3: Combined Filtering

1. User hides "id" column using Columns dropdown
2. User clicks "Modified" badge to show only modified rows
3. User enables column filters
4. User filters "role" column for "Developer"
5. Table shows only modified rows where role contains "Developer"
6. User can still use global filter on top of this

## Visual Indicators

### Active States

- **Column Filters Button**: No special active state (just shows/hides filter row)
- **Column Filter Inputs**: Show X button when text is entered
- **Columns Menu**: Checkmarks indicate visible columns

### Hover States

- All buttons show hover background (hover:bg-accent)
- Filter inputs show focus ring when focused
- Menu items highlight on hover

### Disabled States

- Expand button is disabled when in fullscreen mode
- No other buttons are disabled by default

## Keyboard Accessibility

All new UI elements support keyboard navigation:

- **Columns Dropdown**:
  - Tab to focus button
  - Enter/Space to open
  - Arrow keys to navigate menu items
  - Space to toggle checkboxes
  - Escape to close

- **Column Filters**:
  - Tab to move between filter inputs
  - Type to filter
  - Tab to X button, Enter to clear

## Icons Used

The following Lucide React icons are used:

- `Filter` - Column Filters button (filter icon)
- `Columns3` - Columns button (three vertical lines)
- `X` - Clear filter button (X mark)
- `Check` - Checkbox checked state (checkmark)

## Responsive Behavior

The toolbar adapts to different screen sizes:

- On narrow screens, buttons may wrap to multiple rows
- Filter inputs scale with column width
- Dropdown menu has fixed width (200px) and scrolls if needed

## Color Scheme

Follows the existing design system:

- Buttons: Outline variant with `border-input`
- Filter row: `bg-muted/30` (light background)
- Active filters: Primary color indicators
- Menu: `bg-popover` with `text-popover-foreground`

## Browser Storage

Column visibility state is persisted using:

- **Storage Key**: `csv-diff-viewer-column-visibility`
- **Format**: JSON object `{ "column_id": boolean }`
- **Example**: `{"__diff_type__":true,"id_0":false,"name_1":true}`

## Integration with Existing Features

### Works With:

- ✅ Global text filter
- ✅ Change type badges (All/Added/Removed/Modified)
- ✅ Column sorting (click headers)
- ✅ Row virtualization
- ✅ Fullscreen mode
- ✅ Expanded width mode
- ✅ Show/Hide unchanged rows option

### Does Not Conflict With:

- CSV input/upload
- Comparison mode selection
- Configuration options
- Export functionality (if added later)

## Performance Impact

- **Column visibility toggle**: Instant (no re-render of data)
- **Column filtering**: Uses optimized TanStack Table filter functions
- **localStorage operations**: Minimal overhead, wrapped in error handling
- **Virtual scrolling**: Still active with 20 row overscan
- **No impact on**: WASM comparison speed, memory usage, or parsing

## Comparison with Requirements

| Requirement         | Status             | Implementation                              |
| ------------------- | ------------------ | ------------------------------------------- |
| Column Filtering    | ✅ Complete        | Per-column filter inputs with text matching |
| Column Sorting      | ✅ Already existed | Click column headers to sort                |
| Column Hiding       | ✅ Complete        | Dropdown menu with checkboxes               |
| Session Persistence | ✅ Complete        | localStorage for column visibility          |
| Intuitive UI/UX     | ✅ Complete        | Clear buttons, consistent styling           |
| Documentation       | ✅ Complete        | This guide + ADVANCED_TABLE_FEATURES.md     |

## Screenshot Reference

See the screenshot at: https://github.com/user-attachments/assets/49ea11b9-e1bf-4ac4-82a1-f0fa206b47ca

Note: The screenshot shows the app before the comparison completes. The new table features (Column Filters button, Columns dropdown) would appear in the toolbar area that displays after clicking "Compare Files" and viewing the diff results table.

## Testing Recommendations

To manually test the new features:

1. **Column Visibility**:
   - Hide/show each column
   - Verify localStorage persistence by refreshing page
   - Try hiding all columns except Type

2. **Column Filtering**:
   - Filter each column independently
   - Combine multiple column filters
   - Test with global filter active
   - Verify clear buttons work

3. **Combined Operations**:
   - Hide columns, then filter remaining ones
   - Sort filtered columns
   - Use with change type badges
   - Test in fullscreen mode

4. **Edge Cases**:
   - Very long column names
   - Many columns (10+)
   - Empty filter values
   - Special characters in filters
   - localStorage quota exceeded
