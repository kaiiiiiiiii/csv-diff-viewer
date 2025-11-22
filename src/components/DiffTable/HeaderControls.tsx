import {
  Columns3,
  Expand,
  Filter,
  Maximize2,
  Minimize2,
  Shrink,
} from "lucide-react";
import type { Column } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdvancedSearchInput } from "@/components/AdvancedSearchInput";
import { cn } from "@/lib/utils";

interface HeaderControlsProps {
  globalFilter: string;
  setGlobalFilter: (v: string) => void;
  activeFilter: "all" | "added" | "removed" | "modified";
  setActiveFilter: (v: "all" | "added" | "removed" | "modified") => void;
  counts: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  showColumnFilters: boolean;
  setShowColumnFilters: (v: boolean) => void;
  columns: Array<Column<any>>;
  filteredRowsLength: number;
  isExpanded: boolean;
  setIsExpanded: (v: boolean) => void;
  isFullscreen: boolean;
  setIsFullscreen: (v: boolean) => void;
}

export default function HeaderControls({
  globalFilter,
  setGlobalFilter,
  activeFilter,
  setActiveFilter,
  counts,
  showColumnFilters,
  setShowColumnFilters,
  columns,
  filteredRowsLength,
  isExpanded,
  setIsExpanded,
  isFullscreen,
  setIsFullscreen,
}: HeaderControlsProps) {
  return (
    <div className="flex items-center py-2 gap-2">
      <AdvancedSearchInput
        placeholder='Advanced search (try: term1 OR term2, -exclude, "exact phrase", column:value)...'
        value={globalFilter}
        onChange={setGlobalFilter}
        className="flex-1 max-w-2xl"
      />

      <div className="flex items-center gap-2 ml-2">
        <Badge
          variant={activeFilter === "all" ? "default" : "outline"}
          className="cursor-pointer hover:bg-primary/80"
          onClick={() => setActiveFilter("all")}
        >
          All
        </Badge>
        <Badge
          variant={activeFilter === "added" ? "default" : "outline"}
          className={cn(
            "cursor-pointer transition-colors",
            activeFilter === "added"
              ? "bg-green-500 hover:bg-green-600"
              : "hover:bg-green-100 hover:text-green-800 hover:border-green-200",
            counts.added === 0 &&
              "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-foreground hover:border-border",
          )}
          onClick={() => counts.added > 0 && setActiveFilter("added")}
        >
          Added ({counts.added})
        </Badge>
        <Badge
          variant={activeFilter === "removed" ? "default" : "outline"}
          className={cn(
            "cursor-pointer transition-colors",
            activeFilter === "removed"
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "hover:bg-red-100 hover:text-red-800 hover:border-red-200",
            counts.removed === 0 &&
              "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-foreground hover:border-border",
          )}
          onClick={() => counts.removed > 0 && setActiveFilter("removed")}
        >
          Removed ({counts.removed})
        </Badge>
        <Badge
          variant={activeFilter === "modified" ? "default" : "outline"}
          className={cn(
            "cursor-pointer transition-colors",
            activeFilter === "modified"
              ? "bg-yellow-500 hover:bg-yellow-600 text-white"
              : "hover:bg-yellow-100 hover:text-yellow-800 hover:border-yellow-200",
            counts.modified === 0 &&
              "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-foreground hover:border-border",
          )}
          onClick={() => counts.modified > 0 && setActiveFilter("modified")}
        >
          Modified ({counts.modified})
        </Badge>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground mr-2">
          {filteredRowsLength} rows found
        </span>

        <div className="flex items-center border rounded-md bg-background">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowColumnFilters(!showColumnFilters)}
            className="h-8"
          >
            <Filter className="h-4 w-4" />
          </Button>
          <div className="w-[1px] h-4 bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8">
                <Columns3 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns
                .filter((column) => column.getCanHide())
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {column.id.startsWith("__diff_type__")
                        ? "Type"
                        : column.id.replace(/_\d+$/, "")}
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="items-center border rounded-md bg-background hidden md:flex">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={isFullscreen}
            title={isExpanded ? "Collapse width" : "Expand width"}
          >
            {isExpanded ? (
              <Shrink className="h-4 w-4" />
            ) : (
              <Expand className="h-4 w-4" />
            )}
          </Button>
          <div className="w-[1px] h-4 bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
