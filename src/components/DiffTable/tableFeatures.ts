import {
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_equalsString,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";
import type { Column, Row, Table } from "@tanstack/react-table";

export type DiffRow = Record<string, any> & {
  type: "added" | "removed" | "modified" | "unchanged";
};

// Stable module-level feature set: enables only what DiffTable uses.
export const diffTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    equalsString: filterFn_equalsString,
  },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },
});

export type DiffTableFeatures = typeof diffTableFeatures;
export type DiffTableInstance = Table<DiffTableFeatures, DiffRow>;
export type DiffTableRow = Row<DiffTableFeatures, DiffRow>;
export type DiffTableColumn = Column<DiffTableFeatures, DiffRow>;
