import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { flexRender } from "@tanstack/react-table";
import { X } from "lucide-react";
import type { Row, Table } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface VirtualTableProps {
  table: Table<any>;
  filteredRows: Array<Row<any>>;
  parentRef: React.RefObject<HTMLDivElement | null>;
  showColumnFilters: boolean;
  isFullscreen: boolean;
}

export default function VirtualTable({
  table,
  filteredRows,
  parentRef,
  showColumnFilters,
  isFullscreen,
}: VirtualTableProps) {
  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 20,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div className="rounded-md border bg-background">
      <div
        ref={parentRef}
        className={cn(
          "overflow-auto w-full",
          isFullscreen ? "h-[calc(100vh-120px)]" : "h-[600px]",
        )}
      >
        <table className="w-full caption-bottom text-sm text-left">
          <thead className="sticky top-0 z-10 bg-background shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
              >
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="h-12 px-4 text-left align-middle font-medium text-muted-foreground bg-background"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
            {showColumnFilters && (
              <tr className="border-b bg-muted/30">
                {table.getAllLeafColumns().map((column) => {
                  if (!column.getIsVisible()) return null;
                  return (
                    <th
                      key={column.id}
                      className="px-2 py-2"
                      style={{ width: column.getSize() }}
                    >
                      {column.getCanFilter() ? (
                        <div className="flex items-center gap-1">
                          <Input
                            placeholder={`Filter...`}
                            value={
                              (column.getFilterValue() as string | undefined) ??
                              ""
                            }
                            onChange={(e) =>
                              column.setFilterValue(e.target.value)
                            }
                            className="h-8 text-xs"
                          />
                          {!!column.getFilterValue() && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() => column.setFilterValue(undefined)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {virtualItems.map((virtualRow) => {
              const row = filteredRows[virtualRow.index];
              const rowType = row.original.type;

              return (
                <tr
                  key={row.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  data-state={row.getIsSelected() && "selected"}
                  className={cn(
                    "border-b transition-colors hover:bg-muted/50",
                    rowType === "added" &&
                      "bg-green-50 hover:bg-green-100 dark:bg-green-900/20",
                    rowType === "removed" &&
                      "bg-red-50 hover:bg-red-100 dark:bg-red-900/20",
                    rowType === "modified" &&
                      "bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/20",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="p-4 align-middle"
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
