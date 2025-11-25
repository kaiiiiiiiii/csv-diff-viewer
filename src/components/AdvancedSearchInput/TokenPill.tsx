import { X } from "lucide-react";
import type { SearchToken } from "./parser";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TokenPillProps {
  token: SearchToken;
  onRemove?: () => void;
}

export function TokenPill({ token, onRemove }: TokenPillProps) {
  const label =
    token.type === "exclude"
      ? `-${token.value}`
      : token.type === "phrase"
        ? `"${token.value}"`
        : token.type === "column" && token.column
          ? `${token.column}:${token.value}`
          : token.value;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 bg-muted px-2 py-1 rounded text-xs",
      )}
    >
      <span className="leading-none">{label}</span>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-4 w-4"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

export default TokenPill;
