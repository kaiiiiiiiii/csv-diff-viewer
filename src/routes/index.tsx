import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { useCsvWorker } from '@/hooks/useCsvWorker'
import { useChunkedDiff } from '@/hooks/useChunkedDiff'
import { CsvInput } from '@/components/CsvInput'
import { ConfigPanel } from '@/components/ConfigPanel'
import { DiffStats } from '@/components/DiffStats'
import { DiffTable } from '@/components/DiffTable'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ModeToggle } from '@/components/mode-toggle'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const EXAMPLE_SOURCE = `id,name,role,department
1,John Doe,Developer,Engineering
2,Jane Smith,Designer,Design
3,Bobby Wilson,Manager,Sales
4,Alice Brown,Developer,Engineering
6,Eve Johnson,Intern,Marketing
7,Frank Miller,Analyst,Finance
8,Grace Lee,Consultant,HR
9,Henry Kim,Support,Customer Service
10,Ivy Chen,Engineer,Engineering`

const EXAMPLE_TARGET = `id,name,role,department
1,John Doe,Senior Developer,Engineering
2,Jane Smith,Designer,Design
3,Bobby Wilson,Director,Sales
5,Charlie Davis,Manager,Marketing
8,Grace Lee,Consultant,Human Resources
9,Henry Kim,Team Lead,Customer Service
10,Ivy Chen,Engineer,Engineering
11,Jack White,Developer,Engineering`

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { parse, compare } = useCsvWorker()
  const { startChunkedDiff, loadDiffResults, isProcessing: isChunkedProcessing } = useChunkedDiff()
  const [sourceData, setSourceData] = useState<{
    text: string
    name: string
  } | null>(null)
  const [targetData, setTargetData] = useState<{
    text: string
    name: string
  } | null>(null)

  const [mode, setMode] = useState<'primary-key' | 'content-match'>(
    'content-match',
  )
  const [keyColumns, setKeyColumns] = useState<Array<string>>([])
  const [excludedColumns, setExcludedColumns] = useState<Array<string>>([])
  const [hasHeaders, setHasHeaders] = useState(true)
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [ignoreEmptyVsNull, setIgnoreEmptyVsNull] = useState(true)
  const [useChunkedMode, setUseChunkedMode] = useState(false)
  const [chunkSize, setChunkSize] = useState(10000)

  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{
    percent: number
    message: string
    currentChunk?: number
    totalChunks?: number
  } | null>(null)
  const [showOnlyDiffs, setShowOnlyDiffs] = useState(false)

  const [availableColumns, setAvailableColumns] = useState<Array<string>>([])
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (results && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [results])

  const handleSourceChange = async (text: string, name: string) => {
    setSourceData({ text, name })
    // Parse to get headers for available columns
    if (text) {
      try {
        const res: any = await parse(text, name, hasHeaders)
        setAvailableColumns(res.headers)
      } catch (e) {
        console.error(e)
      }
    }
  }

  const handleTargetChange = (text: string, name: string) => {
    setTargetData({ text, name })
  }

  const handleLoadExample = () => {
    handleSourceChange(EXAMPLE_SOURCE, 'example_source.csv')
    handleTargetChange(EXAMPLE_TARGET, 'example_target.csv')
  }

  const handleCompare = async () => {
    if (!sourceData || !targetData) return

    setLoading(true)
    setResults(null)
    setProgress({ percent: 0, message: 'Starting...' })

    try {
      const sourceParsed = await parse(
        sourceData.text,
        sourceData.name,
        hasHeaders,
      )
      const targetParsed = await parse(
        targetData.text,
        targetData.name,
        hasHeaders,
      )

      // Use chunked mode for large datasets with primary-key mode
      if (useChunkedMode && mode === 'primary-key') {
        const diffId = await startChunkedDiff(
          sourceData.text,
          targetData.text,
          sourceParsed.headers,
          targetParsed.headers,
          {
            comparisonMode: mode,
            keyColumns: keyColumns.filter(Boolean),
            excludedColumns: excludedColumns.filter(Boolean),
            caseSensitive,
            ignoreWhitespace,
            ignoreEmptyVsNull,
            hasHeaders,
            chunkSize,
          },
          (progress) => {
            setProgress({
              percent: progress.percent,
              message: progress.message,
              currentChunk: progress.currentChunk,
              totalChunks: progress.totalChunks,
            })
          },
        )

        // Load results from IndexedDB
        const res = await loadDiffResults(diffId)
        setResults(res)
      } else {
        // Normal mode - load everything into memory
        const res = await compare(
          sourceParsed,
          targetParsed,
          {
            comparisonMode: mode,
            keyColumns: keyColumns.filter(Boolean),
            excludedColumns: excludedColumns.filter(Boolean),
            caseSensitive,
            ignoreWhitespace,
            ignoreEmptyVsNull,
            sourceRaw: sourceData.text,
            targetRaw: targetData.text,
            hasHeaders,
          },
          (percent, message) => setProgress({ percent, message }),
        )
        setResults(res)
      }
    } catch (e: any) {
      alert('Error: ' + e.message)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleLoadExample}>
                <FileSpreadsheet className="h-[1.2rem] w-[1.2rem]" />
                <span className="sr-only">Load Example Data</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Load Example Data</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <ModeToggle />
      </div>
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">CSV Diff Viewer</h1>
        <p className="text-muted-foreground">
          Compare two CSV files directly in your browser.
        </p>
        <div className="flex justify-center gap-2">
          <Badge variant="secondary">Fast</Badge>
          <Badge variant="secondary">Local</Badge>
          <Badge variant="secondary">Private</Badge>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <CsvInput
          title="Source CSV"
          onDataChange={handleSourceChange}
          value={sourceData?.text}
        />
        <CsvInput
          title="Target CSV"
          onDataChange={handleTargetChange}
          value={targetData?.text}
        />
      </div>
      <ConfigPanel
        mode={mode}
        setMode={setMode}
        keyColumns={keyColumns}
        setKeyColumns={setKeyColumns}
        excludedColumns={excludedColumns}
        setExcludedColumns={setExcludedColumns}
        hasHeaders={hasHeaders}
        setHasHeaders={setHasHeaders}
        ignoreWhitespace={ignoreWhitespace}
        setIgnoreWhitespace={setIgnoreWhitespace}
        caseSensitive={caseSensitive}
        setCaseSensitive={setCaseSensitive}
        ignoreEmptyVsNull={ignoreEmptyVsNull}
        setIgnoreEmptyVsNull={setIgnoreEmptyVsNull}
        availableColumns={availableColumns}
        useChunkedMode={useChunkedMode}
        setUseChunkedMode={setUseChunkedMode}
        chunkSize={chunkSize}
        setChunkSize={setChunkSize}
      />{' '}
      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={handleCompare}
          disabled={loading || !sourceData || !targetData}
          className="w-full md:w-auto min-w-[200px]"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {progress ? (
                progress.totalChunks ? (
                  `${Math.round(progress.percent)}% - Chunk ${progress.currentChunk}/${progress.totalChunks}`
                ) : (
                  `${Math.round(progress.percent)}% - ${progress.message}`
                )
              ) : (
                'Processing...'
              )}
            </>
          ) : (
            'Compare Files'
          )}
        </Button>
      </div>
      {results && (
        <div
          ref={resultsRef}
          className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <DiffStats
            added={results.added.length}
            removed={results.removed.length}
            modified={results.modified.length}
            unchanged={results.unchanged.length}
          />

          <div className="flex items-center justify-end space-x-2">
            <label className="text-sm font-medium">Show Only Differences</label>
            <Switch
              checked={showOnlyDiffs}
              onCheckedChange={setShowOnlyDiffs}
            />
          </div>

          <DiffTable results={results} showOnlyDiffs={showOnlyDiffs} />
        </div>
      )}
    </div>
  )
}
