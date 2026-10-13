// Single definition lives in binary-decoder; re-exported for existing callers.
export type { DiffResult, DiffChange, DatasetMetadata } from "./binary-decoder";

export type ProgressCallback = (percent: number, message: string) => void;
