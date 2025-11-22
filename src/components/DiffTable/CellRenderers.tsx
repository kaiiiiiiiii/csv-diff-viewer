import type { CellContext } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// React + TanStack imports for types

export function createDiffCellRenderer(header: string) {
  return (info: CellContext<any, any>) => {
    const row = info.row.original;
    const value = info.getValue() as string | null | undefined;

    if (row.type === "modified") {
      const diff = row.differences?.find((d: any) => d.column === header);
      if (diff) {
        if (diff.diff && Array.isArray(diff.diff)) {
          return (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex flex-wrap gap-1">
                {diff.diff.map((change: any, idx: number) => (
                  <span
                    key={idx}
                    className={cn(
                      change.added &&
                        "bg-green-200 text-green-800 px-1 rounded",
                      change.removed &&
                        "bg-red-200 text-red-800 px-1 rounded line-through",
                      !change.added && !change.removed && "text-gray-600",
                    )}
                  >
                    {change.value}
                  </span>
                ))}
              </div>
            </div>
          );
        }

        return (
          <div className="flex flex-col gap-1 text-xs">
            <span className="line-through text-red-500 opacity-70">
              {diff.oldValue}
            </span>
            <span className="text-green-600 font-medium">{diff.newValue}</span>
          </div>
        );
      }
    }

    // Debug logging for modified rows with missing values is intentionally omitted

    return (
      <span
        className="whitespace-nowrap max-w-[300px] overflow-hidden text-ellipsis block"
        title={String(value)}
      >
        {String(value ?? "")}
      </span>
    );
  };
}

export function TypeBadgeCell(info: CellContext<any, any>) {
  const value = info.getValue() as string;

  return (
    <Badge
      variant={
        value === "added"
          ? "default"
          : value === "removed"
            ? "default"
            : value === "modified"
              ? "secondary"
              : "outline"
      }
      className={cn(
        value === "added" && "bg-green-500 hover:bg-green-600",
        value === "removed" && "bg-red-500 hover:bg-red-600 text-white",
        value === "modified" && "bg-yellow-500 hover:bg-yellow-600 text-white",
      )}
    >
      {value}
    </Badge>
  );
}
