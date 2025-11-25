import { useCallback, useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";

import TokenPill from "./AdvancedSearchInput/TokenPill";
import {
  createAdvancedFilterFn,
  parseSearchQuery,
} from "./AdvancedSearchInput/parser";
import type { SearchToken } from "./AdvancedSearchInput/parser";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AdvancedSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  availableColumns?: Array<string>;
}

/**
 * Parse advanced search query into tokens
 * Supports:
 * - Multiple terms (space separated, AND by default)
 * - OR operator: term1 OR term2
 * - Exclusion: -term
 * - Exact phrases: "exact phrase"
 * - Column-specific: column:value
 */

/**
 * Create a custom filter function that handles advanced search tokens
 */
// Re-export parsing utilities for external usage (e.g. DiffTable)
export {
  parseSearchQuery,
  createAdvancedFilterFn,
} from "./AdvancedSearchInput/parser";

export function AdvancedSearchInput({
  value,
  onChange,
  placeholder = "Advanced search...",
  className,
}: AdvancedSearchInputProps) {
  const [tokens, setTokens] = useState<Array<SearchToken>>([]);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const parsed = parseSearchQuery(value);
    setTokens(parsed);
  }, [value]);

  const handleClear = useCallback(() => {
    onChange("");
  }, [onChange]);

  const removeToken = useCallback(
    (index: number) => {
      const newTokens = tokens.filter((_, i) => i !== index);
      // Reconstruct query from remaining tokens, preserving OR operators
      const newQuery = newTokens
        .map((token, idx) => {
          let term = "";
          if (token.type === "exclude") term = `-${token.value}`;
          else if (token.type === "phrase") term = `"${token.value}"`;
          else if (token.type === "column" && token.column)
            term = `${token.column}:${token.value}`;
          else term = token.value;

          // Add OR operator if this token has OR operator and it's not the first token
          if (token.operator === "OR" && idx > 0) {
            return `OR ${term}`;
          }
          return term;
        })
        .join(" ");
      onChange(newQuery);
    },
    [tokens, onChange],
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="pr-20"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {value && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleClear}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
            <DropdownMenu open={showHelp} onOpenChange={setShowHelp}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <HelpCircle className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[320px]">
                <DropdownMenuLabel>Advanced Search Syntax</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-2 text-xs space-y-2">
                  <div>
                    <div className="font-semibold">Multiple terms (AND)</div>
                    <code className="text-muted-foreground">term1 term2</code>
                    <div className="text-muted-foreground">
                      Match rows containing all terms
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold">OR operator</div>
                    <code className="text-muted-foreground">
                      term1 OR term2
                    </code>
                    <div className="text-muted-foreground">
                      Match rows containing either term
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold">Exclude term</div>
                    <code className="text-muted-foreground">-unwanted</code>
                    <div className="text-muted-foreground">
                      Exclude rows containing term
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold">Exact phrase</div>
                    <code className="text-muted-foreground">
                      "exact phrase"
                    </code>
                    <div className="text-muted-foreground">
                      Match exact phrase
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold">Column-specific</div>
                    <code className="text-muted-foreground">name:john</code>
                    <div className="text-muted-foreground">
                      Search in specific column
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold">Combined example</div>
                    <code className="text-muted-foreground">
                      john OR jane -manager "senior developer"
                    </code>
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      {tokens.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-2">
          {tokens.map((t, idx) => (
            <TokenPill
              key={`${t.type}-${idx}-${t.value}`}
              token={t}
              onRemove={() => removeToken(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
