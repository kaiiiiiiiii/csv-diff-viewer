import { useCallback, useEffect, useState } from 'react'
import { HelpCircle, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SearchToken {
  type: 'term' | 'exclude' | 'phrase' | 'column'
  value: string
  column?: string
  operator?: 'AND' | 'OR'
}

interface AdvancedSearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  availableColumns?: Array<string>
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
export function parseSearchQuery(query: string): Array<SearchToken> {
  const tokens: Array<SearchToken> = []
  let currentPos = 0
  let currentOperator: 'AND' | 'OR' = 'AND'

  while (currentPos < query.length) {
    // Skip whitespace
    while (currentPos < query.length && /\s/.test(query[currentPos])) {
      currentPos++
    }

    if (currentPos >= query.length) break

    // Check for OR operator
    if (query.substring(currentPos, currentPos + 2).toUpperCase() === 'OR') {
      currentOperator = 'OR'
      currentPos += 2
      continue
    }

    // Check for exclusion (-)
    const isExclude = query[currentPos] === '-'
    if (isExclude) currentPos++

    // Check for quoted phrase
    if (query[currentPos] === '"') {
      currentPos++
      const start = currentPos
      while (currentPos < query.length && query[currentPos] !== '"') {
        currentPos++
      }
      const value = query.substring(start, currentPos)
      currentPos++ // skip closing quote
      tokens.push({
        type: isExclude ? 'exclude' : 'phrase',
        value,
        operator: currentOperator,
      })
      currentOperator = 'AND'
      continue
    }

    // Parse regular term or column:value
    const start = currentPos
    while (
      currentPos < query.length &&
      !/\s/.test(query[currentPos]) &&
      query[currentPos] !== '"'
    ) {
      currentPos++
    }
    const term = query.substring(start, currentPos)

    if (!term) continue

    // Check if it's a column:value pair
    const colonIndex = term.indexOf(':')
    if (colonIndex > 0 && colonIndex < term.length - 1) {
      const column = term.substring(0, colonIndex)
      const value = term.substring(colonIndex + 1)
      tokens.push({
        type: 'column',
        value,
        column,
        operator: currentOperator,
      })
    } else {
      tokens.push({
        type: isExclude ? 'exclude' : 'term',
        value: term,
        operator: currentOperator,
      })
    }
    currentOperator = 'AND'
  }

  return tokens
}

/**
 * Create a custom filter function that handles advanced search tokens
 */
export function createAdvancedFilterFn(tokens: Array<SearchToken>) {
  // columnId and filterValue are required by TanStack Table's FilterFn interface but not used
  // since we search across all columns based on the parsed tokens
  return (row: any, _columnId: string, _filterValue: any): boolean => {
    if (tokens.length === 0) return true

    // Helper to extract and normalize values from an object
    const extractValues = (obj: any) => {
      Object.keys(obj).forEach((key) => {
        const val = obj[key]
        rowValues[key] = String(val ?? '').toLowerCase()
      })
    }

    // Get all cell values from the row (including nested values for diff rows)
    const rowValues: Record<string, string> = {}
    extractValues(row.original)

    // Also check nested values for diff rows (sourceRow, targetRow, row)
    if (row.original.sourceRow) extractValues(row.original.sourceRow)
    if (row.original.targetRow) extractValues(row.original.targetRow)
    if (row.original.row) extractValues(row.original.row)

    const allText = Object.values(rowValues).join(' ')

    let lastResult = true
    let currentGroup: Array<boolean> = []
    let groupOperator: 'AND' | 'OR' = 'AND'

    for (const token of tokens) {
      const searchValue = token.value.toLowerCase()
      let matches = false

      if (token.type === 'column' && token.column) {
        // Search in specific column
        const columnValue = rowValues[token.column] ?? ''
        matches = columnValue.includes(searchValue)
      } else if (token.type === 'phrase') {
        // Exact phrase match
        matches = allText.includes(searchValue)
      } else if (token.type === 'exclude') {
        // Exclusion (inverted)
        matches = !allText.includes(searchValue)
      } else {
        // Regular term
        matches = allText.includes(searchValue)
      }

      // Handle operators with left-to-right evaluation
      // Groups consecutive terms with same operator, then combines groups
      // Example: "a b OR c d" evaluates as "(a AND b) OR (c AND d)"
      // Example: "a OR b c" evaluates as "(a) OR (b AND c)"
      if (token.operator === 'OR') {
        if (groupOperator === 'AND' && currentGroup.length > 0) {
          // Finish the AND group before starting OR group
          lastResult = currentGroup.every((r) => r)
          currentGroup = []
        }
        groupOperator = 'OR'
        currentGroup.push(matches)
      } else {
        // AND operator (default)
        if (groupOperator === 'OR' && currentGroup.length > 0) {
          // Finish the OR group before starting AND group
          lastResult = lastResult && currentGroup.some((r) => r)
          currentGroup = []
        }
        groupOperator = 'AND'
        currentGroup.push(matches)
      }
    }

    // Finish the last group
    if (currentGroup.length > 0) {
      if (groupOperator === 'OR') {
        lastResult = lastResult && currentGroup.some((r) => r)
      } else {
        lastResult = lastResult && currentGroup.every((r) => r)
      }
    }

    return lastResult
  }
}

export function AdvancedSearchInput({
  value,
  onChange,
  placeholder = 'Advanced search...',
  className,
}: AdvancedSearchInputProps) {
  const [tokens, setTokens] = useState<Array<SearchToken>>([])
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    const parsed = parseSearchQuery(value)
    setTokens(parsed)
  }, [value])

  const handleClear = useCallback(() => {
    onChange('')
  }, [onChange])

  const removeToken = useCallback(
    (index: number) => {
      const newTokens = tokens.filter((_, i) => i !== index)
      // Reconstruct query from remaining tokens, preserving OR operators
      const newQuery = newTokens
        .map((token, idx) => {
          let term = ''
          if (token.type === 'exclude') term = `-${token.value}`
          else if (token.type === 'phrase') term = `"${token.value}"`
          else if (token.type === 'column' && token.column)
            term = `${token.column}:${token.value}`
          else term = token.value

          // Add OR operator if this token has OR operator and it's not the first token
          if (token.operator === 'OR' && idx > 0) {
            return `OR ${term}`
          }
          return term
        })
        .join(' ')
      onChange(newQuery)
    },
    [tokens, onChange],
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
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
    </div>
  )
}
