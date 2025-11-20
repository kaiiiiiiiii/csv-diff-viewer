import { useMemo, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUpDown, Expand, Maximize2, Minimize2, Shrink } from 'lucide-react'
import FullScreen from 'react-fullscreen-crossbrowser'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface DiffResult {
  added: Array<any>
  removed: Array<any>
  modified: Array<any>
  unchanged: Array<any>
  source: { headers: Array<string> }
  target: { headers: Array<string> }
}

interface DiffTableProps {
  results: DiffResult
  showOnlyDiffs: boolean
}

type DiffRow = any & {
  type: 'added' | 'removed' | 'modified' | 'unchanged'
}

export function DiffTable({ results, showOnlyDiffs }: DiffTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState<
    'all' | 'added' | 'removed' | 'modified'
  >('all')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)

  // 1. Prepare Data
  const data = useMemo(() => {
    const allRows: Array<DiffRow> = []

    allRows.push(...results.modified.map((r) => ({ ...r, type: 'modified' })))
    allRows.push(...results.added.map((r) => ({ ...r, type: 'added' })))
    allRows.push(...results.removed.map((r) => ({ ...r, type: 'removed' })))

    if (!showOnlyDiffs) {
      allRows.push(
        ...results.unchanged.map((r) => ({ ...r, type: 'unchanged' })),
      )
    }
    return allRows
  }, [results, showOnlyDiffs])

  // 2. Define Columns
  const columns = useMemo<Array<ColumnDef<DiffRow>>>(() => {
    const headers =
      results.target.headers.length > 0
        ? results.target.headers
        : results.source.headers

    const dynamicCols: Array<ColumnDef<DiffRow>> = headers.map(
      (header, index) => ({
        id: `${header}_${index}`,
        accessorFn: (row) => {
          if (row.type === 'added') return row.targetRow[header]
          if (row.type === 'removed') return row.sourceRow[header]
          if (row.type === 'unchanged') return row.row[header]
          if (row.type === 'modified') return row.targetRow[header]
          return ''
        },
        header: ({ column }) => {
          return (
            <div
              className="flex items-center cursor-pointer select-none hover:text-foreground"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === 'asc')
              }
            >
              {header}
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </div>
          )
        },
        cell: (info) => {
          const row = info.row.original
          const value = info.getValue() as string | null | undefined

          if (row.type === 'modified') {
            const diff = row.differences?.find((d: any) => d.column === header)
            if (diff) {
              return (
                <div className="flex flex-col gap-1 text-xs">
                  <span className="line-through text-red-500 opacity-70">
                    {diff.oldValue}
                  </span>
                  <span className="text-green-600 font-medium">
                    {diff.newValue}
                  </span>
                </div>
              )
            }
          }

          // Debug logging for modified rows with missing values
          if (row.type === 'modified' && (value === undefined || value === null || value === '')) {
             // console.log('Missing value for modified row:', { header, row, value });
          }

          return (
            <span
              className="whitespace-nowrap max-w-[300px] overflow-hidden text-ellipsis block"
              title={String(value)}
            >
              {String(value ?? '')}
            </span>
          )
        },
      }),
    )

    return [
      {
        id: '__diff_type__',
        accessorKey: 'type',
        header: 'Type',
        size: 100,
        cell: (info) => (
          <Badge
            variant={
              info.getValue() === 'added'
                ? 'default'
                : info.getValue() === 'removed'
                  ? 'default'
                  : info.getValue() === 'modified'
                    ? 'secondary'
                    : 'outline'
            }
            className={cn(
              info.getValue() === 'added' && 'bg-green-500 hover:bg-green-600',
              info.getValue() === 'removed' &&
                'bg-red-500 hover:bg-red-600 text-white',
              info.getValue() === 'modified' &&
                'bg-yellow-500 hover:bg-yellow-600 text-white',
            )}
          >
            {info.getValue() as string}
          </Badge>
        ),
      },
      ...dynamicCols,
    ]
  }, [results])

  // 3. Initialize Table
  const table = useReactTable({
    data,
    columns,
    getRowId: (row, index) => String(index),
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const { rows } = table.getRowModel()

  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, modified: 0, unchanged: 0 }
    rows.forEach((row) => {
      const type = row.original.type as keyof typeof c
      c[type]++
    })
    return c
  }, [rows])

  const filteredRows = useMemo(() => {
    if (activeFilter === 'all') return rows
    return rows.filter((row) => row.original.type === activeFilter)
  }, [rows, activeFilter])

  // 4. Initialize Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 20,
  })

  const virtualItems = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0

  return (
    <FullScreen enabled={isFullscreen} onChange={setIsFullscreen}>
      <div
        className={cn(
          'space-y-4 bg-background',
          isExpanded &&
            !isFullscreen &&
            'w-screen relative left-[50%] right-[50%] -ml-[50vw] -mr-[50vw] px-8',
          isFullscreen && 'h-screen w-screen overflow-auto p-8',
        )}
      >
        <div className="flex items-center py-2 gap-2">
          <Input
            placeholder="Filter all columns..."
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            className="max-w-sm"
          />

          <div className="flex items-center gap-2 ml-2">
            <Badge
              variant={activeFilter === 'all' ? 'default' : 'outline'}
              className="cursor-pointer hover:bg-primary/80"
              onClick={() => setActiveFilter('all')}
            >
              All
            </Badge>
            <Badge
              variant={activeFilter === 'added' ? 'default' : 'outline'}
              className={cn(
                'cursor-pointer transition-colors',
                activeFilter === 'added'
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'hover:bg-green-100 hover:text-green-800 hover:border-green-200',
                counts.added === 0 &&
                  'opacity-50 cursor-not-allowed hover:bg-transparent hover:text-foreground hover:border-border',
              )}
              onClick={() => counts.added > 0 && setActiveFilter('added')}
            >
              Added ({counts.added})
            </Badge>
            <Badge
              variant={activeFilter === 'removed' ? 'default' : 'outline'}
              className={cn(
                'cursor-pointer transition-colors',
                activeFilter === 'removed'
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'hover:bg-red-100 hover:text-red-800 hover:border-red-200',
                counts.removed === 0 &&
                  'opacity-50 cursor-not-allowed hover:bg-transparent hover:text-foreground hover:border-border',
              )}
              onClick={() => counts.removed > 0 && setActiveFilter('removed')}
            >
              Removed ({counts.removed})
            </Badge>
            <Badge
              variant={activeFilter === 'modified' ? 'default' : 'outline'}
              className={cn(
                'cursor-pointer transition-colors',
                activeFilter === 'modified'
                  ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                  : 'hover:bg-yellow-100 hover:text-yellow-800 hover:border-yellow-200',
                counts.modified === 0 &&
                  'opacity-50 cursor-not-allowed hover:bg-transparent hover:text-foreground hover:border-border',
              )}
              onClick={() => counts.modified > 0 && setActiveFilter('modified')}
            >
              Modified ({counts.modified})
            </Badge>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2">
              {filteredRows.length} rows found
            </span>
            <div className="flex items-center border rounded-md bg-background">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsExpanded(!isExpanded)}
                disabled={isFullscreen}
                title={isExpanded ? 'Collapse width' : 'Expand width'}
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
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
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

        <div className="rounded-md border bg-background">
          {/* Scroll Container */}
          <div
            ref={parentRef}
            className={cn(
              'overflow-auto w-full',
              isFullscreen ? 'h-[calc(100vh-120px)]' : 'h-[600px]',
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
              </thead>
              <tbody>
                {paddingTop > 0 && (
                  <tr>
                    <td style={{ height: `${paddingTop}px` }} />
                  </tr>
                )}
                {virtualItems.map((virtualRow) => {
                  const row = filteredRows[virtualRow.index]
                  const rowType = row.original.type

                  return (
                    <tr
                      key={row.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      data-state={row.getIsSelected() && 'selected'}
                      className={cn(
                        'border-b transition-colors hover:bg-muted/50',
                        rowType === 'added' &&
                          'bg-green-50 hover:bg-green-100 dark:bg-green-900/20',
                        rowType === 'removed' &&
                          'bg-red-50 hover:bg-red-100 dark:bg-red-900/20',
                        rowType === 'modified' &&
                          'bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/20',
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
                  )
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
      </div>
    </FullScreen>
  )
}
