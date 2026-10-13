export interface ThreadProgress {
  threadId: number;
  processed: number;
  perThreadTotal: number;
  /** Global percent carried by the message, when present */
  globalProgress?: number;
}

/**
 * Parse a THREAD_PROGRESS message emitted by the parallel WASM paths.
 * Legacy: THREAD_PROGRESS|<id>|<processed>|<perThreadTotal>
 * JSON:   THREAD_PROGRESS_JSON|{"threadId":0,"processed":50,"perThreadTotal":125,"globalProgress":75}
 * Returns null for any other (or malformed) message.
 */
export function parseThreadProgress(message: unknown): ThreadProgress | null {
  if (typeof message !== "string") return null;

  if (message.startsWith("THREAD_PROGRESS_JSON|")) {
    try {
      const data = JSON.parse(message.slice("THREAD_PROGRESS_JSON|".length));
      if (
        typeof data.threadId === "number" &&
        typeof data.processed === "number" &&
        typeof data.perThreadTotal === "number"
      ) {
        return {
          threadId: data.threadId,
          processed: data.processed,
          perThreadTotal: data.perThreadTotal,
          globalProgress:
            typeof data.globalProgress === "number"
              ? data.globalProgress
              : undefined,
        };
      }
    } catch {
      // Malformed JSON is treated as a regular progress message
    }
    return null;
  }

  if (message.startsWith("THREAD_PROGRESS|")) {
    const parts = message.split("|");
    if (parts.length !== 4) return null;
    const threadId = parseInt(parts[1], 10);
    const processed = parseInt(parts[2], 10);
    const perThreadTotal = parseInt(parts[3], 10);
    if (Number.isNaN(threadId)) return null;
    return { threadId, processed, perThreadTotal };
  }

  return null;
}

/**
 * Estimate the number of data rows by counting line breaks (\n, \r\n, lone \r)
 * without allocating a split array. Quoted newlines are counted too, so this
 * is only an estimate, suitable for progress reporting.
 */
export function countRows(text: string, hasHeaders: boolean): number {
  let lines = 0;
  let lastLineHasContent = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13) {
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      lines++;
      lastLineHasContent = false;
    } else {
      lastLineHasContent = true;
    }
  }
  if (lastLineHasContent) lines++;
  return Math.max(0, lines - (hasHeaders ? 1 : 0));
}

/**
 * Wrap a progress callback so it fires at most once per `intervalMs`.
 * 100% updates always pass through so the final state is never dropped.
 */
export function throttleProgress(
  emit: (percent: number, message: string) => void,
  intervalMs = 50,
  now: () => number = () => performance.now(),
): (percent: number, message: string) => void {
  let last = -Infinity;
  return (percent, message) => {
    const t = now();
    if (percent >= 100 || t - last >= intervalMs) {
      last = t;
      emit(percent, message);
    }
  };
}

export function isDuplicateKeyError(error: unknown): boolean {
  const message =
    (error as { message?: string } | null)?.message ?? String(error);
  return /duplicate primary key/i.test(message);
}
