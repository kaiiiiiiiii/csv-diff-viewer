export interface PerformanceMetrics {
  startTime: number;
  parseTime?: number;
  diffTime?: number;
  serializeTime?: number;
  totalTime?: number;
  memoryUsed?: number;
}

export interface ParsePayload {
  csvText: string;
  name: string;
  hasHeaders?: boolean;
}

export interface ComparePayload {
  comparisonMode: "primary-key" | "content-match"; // inferred type, could be string
  keyColumns?: Array<string>;
  caseSensitive?: boolean;
  ignoreWhitespace?: boolean;
  ignoreEmptyVsNull?: boolean;
  excludedColumns?: Array<string>;
  sourceRaw: string;
  targetRaw: string;
  hasHeaders?: boolean;
}

export interface InitDifferPayload extends ComparePayload {}

export interface DiffChunkPayload {
  chunkStart: number;
  chunkSize: number;
}

export interface WorkerRequest {
  requestId: number;
  type: "parse" | "compare" | "init-differ" | "diff-chunk" | "cleanup-differ";
  data: any; // Specific payload based on type
}

export interface WorkerResponse {
  requestId: number;
  type: string;
  data?: any;
  metrics?: PerformanceMetrics;
  error?: any;
}

export type ProgressCallback = (percent: number, message: string) => void;
