import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import FullScreen from "react-fullscreen-crossbrowser";
import type {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
  createAdvancedFilterFn,
  parseSearchQuery,
} from "@/components/AdvancedSearchInput";
import HeaderControls from "@/components/DiffTable/HeaderControls";
import VirtualTable from "@/components/DiffTable/VirtualTable";
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

type DiffRow = any & {
  type: "added" | "removed" | "modified" | "unchanged";
};

const STORAGE_KEY = "csv-diff-viewer-column-visibility";

export function DiffTable({ results, showOnlyDiffs }: DiffTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
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
      console.error(
        "Failed to load column visibility from localStorage:",
        error,
      );
    }
  }, []);

  // Save column visibility to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columnVisibility));
    } catch (error) {
      console.error("Failed to save column visibility to localStorage:", error);
    }
  }, [columnVisibility]);

  // 1. Prepare Data
  const data = useMemo(() => {
    const allRows: Array<DiffRow> = [];

    allRows.push(...results.modified.map((r) => ({ ...r, type: "modified" })));
    allRows.push(...results.added.map((r) => ({ ...r, type: "added" })));
    allRows.push(...results.removed.map((r) => ({ ...r, type: "removed" })));

    if (!showOnlyDiffs) {
      allRows.push(
        ...results.unchanged.map((r) => ({ ...r, type: "unchanged" })),
      );
    }
    return allRows;
  }, [results, showOnlyDiffs]);

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

  const columns = useMemo<Array<ColumnDef<DiffRow>>>(() => {
    const headers = availableColumns;

    const dynamicCols: Array<ColumnDef<DiffRow>> = headers.map(
      (header, index) => ({
        id: `${header}_${index}`,
        accessorFn: (row) => {
          if (row.type === "added") return row.targetRow[header];
          if (row.type === "removed") return row.sourceRow[header];
          if (row.type === "unchanged") return row.row[header];
          if (row.type === "modified") return row.targetRow[header];
          return "";
        },
        enableColumnFilter: true,
        enableHiding: true,
        filterFn: "includesString",
        header: ({ column }) => {
          return (
            <div
              className="flex items-center cursor-pointer select-none hover:text-foreground"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              {header}
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </div>
          );
        },
        cell: createDiffCellRenderer(header),
      }),
    );

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

  const table = useReactTable({
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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const { rows } = table.getRowModel();

  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, modified: 0, unchanged: 0 };
    rows.forEach((row) => {
      const type = row.original.type as keyof typeof c;
      c[type]++;
    });
    return c;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (activeFilter === "all") return rows;
    return rows.filter((row) => row.original.type === activeFilter);
  }, [rows, activeFilter]);

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
          columns={table.getAllColumns()}
          filteredRowsLength={filteredRows.length}
          isExpanded={isExpanded}
          setIsExpanded={setIsExpanded}
          isFullscreen={isFullscreen}
          setIsFullscreen={setIsFullscreen}
        />

        <VirtualTable
          table={table}
          filteredRows={filteredRows}
          parentRef={parentRef}
          showColumnFilters={showColumnFilters}
          isFullscreen={isFullscreen}
        />
      </div>
    </FullScreen>
  );
}
