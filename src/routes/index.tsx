import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useCsvWorker } from "@/hooks/useCsvWorker";
import { createScopedLogger } from "@/lib/dev-logger";
import {
  computeAvailableColumns,
  hasGeneratedHeaders,
  mergeCompareResult,
} from "@/lib/route-helpers";
import { metricsCollector } from "@/lib/performance-metrics";
import { CsvInput } from "@/components/CsvInput";
import { ConfigPanel } from "@/components/ConfigPanel";
import { DiffStats } from "@/components/DiffStats";
import { DiffTable } from "@/components/DiffTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ModeToggle } from "@/components/mode-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const EXAMPLE_SOURCE = `id,name,role,department
1,John Doe,Developer,Engineering
2,Jane Smith,Designer,Design
3,Bobby Wilson,Manager,Sales
4,Alice Brown,Developer,Engineering
6,Eve Johnson,Intern,Marketing
7,Frank Miller,Analyst,Finance
8,Grace Lee,Consultant,HR
9,Henry Kim,Support,Customer Service
10,Ivy Chen,Engineer,Engineering`;

const EXAMPLE_TARGET = `id,name,role,department
1,John Doe,Senior Developer,Engineering
2,Jane Smith,Designer,Design
3,Bobby Wilson,Director,Sales
5,Charlie Davis,Manager,Marketing
8,Grace Lee,Consultant,Human Resources
9,Henry Kim,Team Lead,Customer Service
10,Ivy Chen,Engineer,Engineering
11,Jack White,Developer,Engineering`;

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
};

type Side = "source" | "target";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { parse, compare, warmWasm } = useCsvWorker();
  const [sourceData, setSourceData] = useState<{
    text: string;
    name: string;
  } | null>(null);
  const [targetData, setTargetData] = useState<{
    text: string;
    name: string;
  } | null>(null);
  const routeLogger = useMemo(() => createScopedLogger("Compare Route"), []);

  const [mode, setMode] = useState<"primary-key" | "content-match">(
    "content-match",
  );
  const [keyColumns, setKeyColumns] = useState<Array<string>>([]);
  const [excludedColumns, setExcludedColumns] = useState<Array<string>>([]);
  const [hasHeaders, setHasHeaders] = useState(true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [ignoreEmptyVsNull, setIgnoreEmptyVsNull] = useState(true);

  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{
    percent: number;
    message: string;
  } | null>(null);
  const [showOnlyDiffs, setShowOnlyDiffs] = useState(false);

  const [headers, setHeaders] = useState<{
    source: Array<string> | null;
    target: Array<string> | null;
  }>({ source: null, target: null });
  const [headerWarnings, setHeaderWarnings] = useState<{
    source: string | null;
    target: string | null;
  }>({ source: null, target: null });
  // Request counters: only the latest async parse/compare may update state
  const detectRequestRef = useRef<Record<Side, number>>({
    source: 0,
    target: 0,
  });
  const compareRequestRef = useRef(0);
  const mountedRef = useRef(true);

  const availableColumns = useMemo(
    () => computeAvailableColumns(headers.source, headers.target),
    [headers],
  );
  const headerDetectionWarning = headerWarnings.source ?? headerWarnings.target;

  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (results && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [results]);

  // Warm up WASM on component mount
  useEffect(() => {
    let cancelled = false;

    warmWasm()
      .then(() => {
        if (!cancelled) {
          routeLogger.info("WASM warmed up successfully");
          metricsCollector.logMetrics();
        }
      })
      .catch((error) => {
        if (!cancelled) {
          routeLogger.error("Failed to warm up WASM", error);
          metricsCollector.logMetrics();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [warmWasm, routeLogger]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Detect headers whenever an input or the hasHeaders flag changes
  const detectHeaders = (
    side: Side,
    data: { text: string; name: string } | null,
  ) => {
    const requestId = ++detectRequestRef.current[side];
    setHeaders((prev) => ({ ...prev, [side]: null }));
    setHeaderWarnings((prev) => ({ ...prev, [side]: null }));
    if (!data?.text) return;

    parse(data.text, data.name, hasHeaders, true)
      .then((res: any) => {
        if (detectRequestRef.current[side] !== requestId) return;
        setHeaders((prev) => ({ ...prev, [side]: res.headers }));
        if (hasHeaders && hasGeneratedHeaders(res.headers)) {
          setHeaderWarnings((prev) => ({
            ...prev,
            [side]: `Auto-detected that "${data.name}" doesn't have headers. Using generated column names (Column1, Column2, etc.). You can disable "Has Headers" if this is incorrect.`,
          }));
        }
      })
      .catch((e) => {
        if (detectRequestRef.current[side] !== requestId || !mountedRef.current)
          return;
        routeLogger.error(`Failed to parse ${side} CSV`, formatError(e));
      });
  };

  useEffect(() => {
    detectHeaders("source", sourceData);
  }, [sourceData, hasHeaders]);
  useEffect(() => {
    detectHeaders("target", targetData);
  }, [targetData, hasHeaders]);

  // Any input or option change invalidates shown results and in-flight compares
  useEffect(() => {
    compareRequestRef.current++;
    setResults(null);
    setLoading(false);
    setProgress(null);
  }, [
    sourceData,
    targetData,
    hasHeaders,
    mode,
    keyColumns,
    excludedColumns,
    ignoreWhitespace,
    caseSensitive,
    ignoreEmptyVsNull,
  ]);

  const handleDataChange = (side: Side) => (text: string, name: string) => {
    (side === "source" ? setSourceData : setTargetData)({ text, name });
  };
  const handleSourceChange = handleDataChange("source");
  const handleTargetChange = handleDataChange("target");

  const handleLoadExample = () => {
    handleSourceChange(EXAMPLE_SOURCE, "example_source.csv");
    handleTargetChange(EXAMPLE_TARGET, "example_target.csv");
  };

  const handleCompare = async () => {
    if (!sourceData || !targetData) return;

    const requestId = ++compareRequestRef.current;
    const isStale = () =>
      !mountedRef.current || compareRequestRef.current !== requestId;

    setLoading(true);
    setResults(null);
    setProgress({ percent: 0, message: "Starting..." });

    // Start total operation timer
    metricsCollector.startTimer("totalTime");

    try {
      // Headers are normally known from detection; otherwise read just the
      // header sample instead of fully parsing (Rust re-parses for compare).
      const readHeaders = async (side: Side, data: typeof sourceData) =>
        headers[side] ??
        (
          (await parse(data.text, data.name, hasHeaders, true)) as {
            headers: Array<string>;
          }
        ).headers;
      const [sourceHeaders, targetHeaders] = await Promise.all([
        readHeaders("source", sourceData),
        readHeaders("target", targetData),
      ]);
      if (isStale()) return;

      const options = {
        comparisonMode: mode,
        keyColumns: keyColumns.filter(Boolean),
        excludedColumns: excludedColumns.filter(Boolean),
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        sourceRaw: sourceData.text,
        targetRaw: targetData.text,
        hasHeaders,
      };
      const res = await compare(null, null, options, (percent, message) => {
        if (!isStale()) setProgress({ percent, message });
      });
      if (isStale()) return;
      setResults(
        mergeCompareResult(res, options, sourceHeaders, targetHeaders),
      );

      // Log metrics for debugging
      metricsCollector.endTimer("totalTime");
      metricsCollector.logMetrics();
    } catch (e: any) {
      metricsCollector.endTimer("totalTime");
      if (!isStale()) alert("Error: " + (e?.message ?? String(e)));
    } finally {
      if (!isStale()) {
        setLoading(false);
        setProgress(null);
      }
    }
  };

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
      {headerDetectionWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-amber-800">
                Header Detection
              </h3>
              <div className="mt-2 text-sm text-amber-700">
                <p>{headerDetectionWarning}</p>
              </div>
            </div>
          </div>
        </div>
      )}
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
      />
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
              {progress
                ? `${Math.round(progress.percent)}% - ${progress.message}`
                : "Processing..."}
            </>
          ) : (
            "Compare Files"
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
  );
}
