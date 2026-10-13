import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import FullScreen from "@/components/DiffTable/FullScreen";
import type {
  ColumnDef,
  ColumnFiltersState,
  ColumnVisibilityState,
  SortingState,
} from "@tanstack/react-table";
import type {
  DiffRow,
  DiffTableFeatures,
} from "@/components/DiffTable/tableFeatures";
import { cn } from "@/lib/utils";
import { createScopedLogger } from "@/lib/dev-logger";
import {
  createAdvancedFilterFn,
  parseSearchQuery,
} from "@/components/AdvancedSearchInput";
import HeaderControls from "@/components/DiffTable/HeaderControls";
import VirtualTable from "@/components/DiffTable/VirtualTable";
import { countDiffTypes } from "@/components/DiffTable/counts";
import { diffTableFeatures } from "@/components/DiffTable/tableFeatures";
import {
  TypeBadgeCell,
  createDiffCellRenderer,
} from "@/components/DiffTable/CellRenderers";

interface DiffResult {
  added: Array<any>;
  removed: Array<any>;
  modified: Array<any>;
  unchanged: Array<any>;
  source: { headers: Array<string> };
  target: { headers: Array<string> };
}

interface DiffTableProps {
  results: DiffResult;
  showOnlyDiffs: boolean;
}

const STORAGE_KEY = "csv-diff-viewer-column-visibility";
const tableLogger = createScopedLogger("DiffTable");

export const DiffTable = memo(function DiffTableInner({
  results,
  showOnlyDiffs,
}: DiffTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] =
    useState<ColumnVisibilityState>({});
  const [activeFilter, setActiveFilter] = useState<
    "all" | "added" | "removed" | "modified"
  >("all");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showColumnFilters, setShowColumnFilters] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  // Load column visibility from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setColumnVisibility(parsed);
      }
    } catch (error) {
      tableLogger.error("Failed to load column visibility", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  // Save column visibility to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columnVisibility));
    } catch (error) {
      tableLogger.error("Failed to persist column visibility", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [columnVisibility]);

  // 1. Prepare Data
  // Rows are tagged once per results object; toggling showOnlyDiffs only recombines.
  const diffRows = useMemo<Array<DiffRow>>(
    () => [
      ...results.modified.map((r) => ({ ...r, type: "modified" })),
      ...results.added.map((r) => ({ ...r, type: "added" })),
      ...results.removed.map((r) => ({ ...r, type: "removed" })),
    ],
    [results],
  );

  const unchangedRows = useMemo<Array<DiffRow>>(
    () => results.unchanged.map((r) => ({ ...r, type: "unchanged" })),
    [results],
  );

  const data = useMemo(
    () => (showOnlyDiffs ? diffRows : [...diffRows, ...unchangedRows]),
    [diffRows, unchangedRows, showOnlyDiffs],
  );

  // 2. Define Columns
  const availableColumns = useMemo(() => {
    const sourceHeaders = results.source.headers;
    const targetHeaders = results.target.headers;

    // Create a union of headers while preserving order as much as possible
    const headerSet = new Set(targetHeaders);
    const combinedHeaders = [...targetHeaders];

    sourceHeaders.forEach((h) => {
      if (!headerSet.has(h)) {
        combinedHeaders.push(h);
      }
    });

    return combinedHeaders.length > 0 ? combinedHeaders : sourceHeaders;
  }, [results]);

  const columns = useMemo<Array<ColumnDef<DiffTableFeatures, DiffRow>>>(() => {
    const headers = availableColumns;

    const dynamicCols: Array<ColumnDef<DiffTableFeatures, DiffRow>> =
      headers.map((header, index) => ({
        id: `${header}_${index}`,
        accessorFn: (row) => {
          if (row.type === "removed") return row.sourceRow[header];
          if (row.type === "unchanged") return row.row[header];
          // added and modified rows show the target side
          return row.targetRow[header];
        },
        enableColumnFilter: true,
        enableHiding: true,
        filterFn: "includesString",
        header: ({ column }) => {
          return (
            <button
              type="button"
              className="flex items-center cursor-pointer select-none hover:text-foreground"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              {header}
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </button>
          );
        },
        cell: createDiffCellRenderer(header),
      }));

    return [
      {
        id: "__diff_type__",
        accessorKey: "type",
        header: "Type",
        size: 100,
        enableColumnFilter: true,
        enableHiding: true,
        filterFn: "equalsString",
        cell: TypeBadgeCell,
      },
      ...dynamicCols,
    ];
  }, [results, availableColumns]);

  // 3. Initialize Table
  const globalFilterFn = useMemo(() => {
    const tokens = parseSearchQuery(globalFilter);
    return createAdvancedFilterFn(tokens);
  }, [globalFilter]);

  const table = useTable({
    features: diffTableFeatures,
    data,
    columns,
    getRowId: (_row, index) => String(index),
    state: {
      sorting,
      globalFilter,
      columnFilters,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn,
  });

  const { rows } = table.getRowModel();

  // Counts reflect the unfiltered results so badges don't shrink while searching
  const counts = useMemo(
    () => countDiffTypes(results, showOnlyDiffs),
    [results, showOnlyDiffs],
  );

  const filteredRows = useMemo(() => {
    if (activeFilter === "all") return rows;
    return rows.filter((row) => row.original.type === activeFilter);
  }, [rows, activeFilter]);

  const allColumns = useMemo(() => table.getAllColumns(), [table, columns]);

  // table is a stable instance, so list the state that changes its output
  const virtualTable = useMemo(
    () => (
      <VirtualTable
        table={table}
        filteredRows={filteredRows}
        parentRef={parentRef}
        showColumnFilters={showColumnFilters}
        isFullscreen={isFullscreen}
      />
    ),
    [
      table,
      filteredRows,
      showColumnFilters,
      isFullscreen,
      sorting,
      columnFilters,
      columnVisibility,
    ],
  );

  // 4. NOTE: Virtualization, headers and cell rendering are handled by subcomponents

  return (
    <FullScreen enabled={isFullscreen} onChange={setIsFullscreen}>
      <div
        className={cn(
          "space-y-4 bg-background",
          isExpanded &&
            !isFullscreen &&
            "w-screen relative left-[50%] right-[50%] -ml-[50vw] -mr-[50vw] px-8",
          isFullscreen && "h-screen w-screen overflow-auto p-8",
        )}
      >
        <HeaderControls
          globalFilter={globalFilter}
          setGlobalFilter={setGlobalFilter}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          counts={counts}
          showColumnFilters={showColumnFilters}
          setShowColumnFilters={setShowColumnFilters}
          columns={allColumns}
          filteredRowsLength={filteredRows.length}
          isExpanded={isExpanded}
          setIsExpanded={setIsExpanded}
          isFullscreen={isFullscreen}
          setIsFullscreen={setIsFullscreen}
        />

        {virtualTable}
      </div>
    </FullScreen>
  );
});
