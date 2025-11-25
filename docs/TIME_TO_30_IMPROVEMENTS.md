# Time-to-30% Improvements (Startup / Initial Progress)

💡 Overview

This document summarizes findings, root causes, recommended changes, and an implementation plan for reducing the time-to-30% (perceived startup latency) in csv-diff-viewer. The goal: bring visible progress to users faster and lower perceived waiting time when doing large CSV diffs (1M+ rows).

This is Option A: documentation-only deliverable (no PR created). The doc covers both short-term quick wins and longer-term architectural changes.

---

## TL;DR

- Main causes of delayed progress:
  1. WASM initialization (fetch + instantiation + thread pool init) performed on the first request
  2. UI parse calls run before compare and emit no progress (full parse happens at UI side and WASM side again)
  3. WASM diff functions re-parse CSVs and perform heavy preprocessing (building maps/fingerprint) before they emit progress phases
  4. Streaming/Chunked diffing exists but is not used in primary compare flows

- Quick actions with high-impact: Pre-warm WASM, add header-only parse for UI, add parse progress callback
- Medium/Longer-term: Avoid double parsing, use chunked `diff_chunk()` path, persist parsed rows, or zero-copy transfer usage

---

## Key Findings & Evidence

### 1) WASM Initialization Blocks Work

- Files: `src/wasm-context.ts`, `src/workers/csv.worker.ts`
- Behavior: The worker initializes the WASM bundle on the first request. On slow networks or large WASM payloads or thread pool initialization, this blocks the first user action.
- Evidence: `initWasm()` fetch and `initSync` call, plus `init_wasm_thread_pool()`/related setup in the worker.

Why it matters: Users see no progress while the binary and thread pool are still being downloaded and initialized.

---

### 2) Double Parsing (UI + WASM) and No Parse Progress

- Files: `src/routes/index.tsx`, `src/hooks/useCsvWorker.ts`, `src/workers/handlers/parse.ts`, `src-wasm/src/parse.rs`
- Behavior: UI calls `parse(...)` for both source & target (for header detection etc.). The worker parse handler performs a full CSV parse and then returns `parse-complete` only at the end (no progress events). The `compare` handler calls full diff functions which re-parse the raw CSV strings on the WASM side, leading to double parsing and extra blocking work before compare progress is emitted.
- Evidence: `parse_csv_internal` implementation and the compare functions (`diff_csv_internal`, `diff_csv_primary_key_internal`) that call it again.

Why it matters: Parsing can be a big portion of the startup time, especially for large files; doing it twice doubles the cost.

---

### 3) Heavy Pre-processing Happens Before Progress

- Files: `src-wasm/src/content_match.rs`, `src-wasm/src/primary_key.rs`
- Behavior: After parsing, WASM performs indexing/fingerprint building and other pre-processing steps before emitting the bulk of progress updates (e.g., building the fingerprint index at 20% in content-match). The initial progress events for compare are sent only after the parse or pre-processing is done.
- Evidence: `on_progress(0.0, 'Parsing source CSV...')`, `on_progress(10.0, 'Parsing target CSV...')`, `on_progress(20.0, 'Building fingerprint index...')` etc.

Why it matters: Users experience a cold start until the phrased progress phases begin — 0% → 30% still feels frozen.

---

### 4) Streaming/Chunked Path Exists but Is Underused

- Files: `src-wasm/src/streaming.rs`, `src-wasm/src/core.rs`
- Behavior: A streaming chunked `diff_chunk` API exists with a configurable `chunk_size` and `progress_update_interval`, but `compare` often uses the full-diff API and doesn't utilize this streaming path.
- Evidence: `StreamingConfig { chunk_size: 5000, progress_update_interval: 10 }` and `pub fn diff_chunk(...)` signatures.

Why it matters: Chunked processing allows emitting progress early and delivering partial results, which dramatically lowers perceived latency.

---

## Recommendations (Prioritized)

These are grouped into short-term quick wins, medium-term (refactoring), and long-term (architectural) changes.

### Short-term (Low complexity, high impact)

1. Pre-warm WASM on app load
   - Trigger `initWasm()` on app start or send a `noop` worker message in `useWorkerStatus`.
   - Benefits: Remove first-request WASM fetch/initialization from the critical path.
   - Complexity: Low

2. Add a Header-only parse API
   - Add `headers_only` flag (or `parseHeadersOnly` route) to parse API. The UI should use it for header detection and validation.
   - Benefits: UI no longer do full parse for header detection — alleviates early work.
   - Complexity: Low

3. Add parse progress callback
   - Implement `parse_csv_with_progress` in WASM and wire a `on_progress` callback for the parse route so UI gets progress events during parse.
   - Benefits: The UI stops appearing frozen during large file parsing.
   - Complexity: Medium

### Medium-term (Refactors & API changes)

4. Avoid Double Parsing: Persist parsed state
   - Implement `persistParsed` or `initDiffer` in worker/WASM so the parsed representation is stored, then `compare` reuses it rather than re-parsing raw CSV.
   - Benefits: Removes the duplicate parsing step and reduces total work done; also easier to stream large data through WASM memory.
   - Complexity: High

5. Use streaming/diff_chunk for incremental compare
   - Use `initDiffer` + iterative `diff_chunk` calls with configurable `chunkSize` and `progress_update_interval`. Stream partial results to IndexedDB and render them incrementally.
   - Benefits: Frequent progress events and early partial results for UI.
   - Complexity: Medium-High

### Long-term (Further improvements)

6. Expose runtime tuning parameters to the UI
   - `chunkSize`, `progress_update_interval`, and `parallel` toggles
   - Benefits: Fine-tune performance by hardware or dataset size.
   - Complexity: Low

7. Add performance instrumentation & metrics
   - Add `wasmInitTime`, `parseTime`, `timeToFirstProgress`, `timeTo30Percent`, `totalDiffTime`. Log these to `PerformanceDashboard` and `dev-log`.
   - Benefits: Measure the effect of optimizations and guide future improvements.
   - Complexity: Low

---

## Detailed Implementation Steps (Short-term & Medium-term)

### Pre-warm WASM at App Startup

1. Add a `warmWasm` or `noop` worker request when the app starts: e.g., `useWorkerStatus.ts` or `app.tsx` mount.
2. The worker handler for this message calls `initWasm()` and `init_wasm_thread_pool()` if not already done, but returns immediately (success message) so the UI can show a `ready` boolean.
3. Add `dev-log` message `wasm-ready` when initialization completes.

Files to update: `src/hooks/useWorkerStatus.ts`, `src/wasm-context.ts`, `src/workers/csv.worker.ts`.

Code snippet (example):

```ts
// src/hooks/useWorkerStatus.ts
useEffect(() => {
  workerRequest({ type: "warm-wasm" })
    .then(() => setWorkerReady(true))
    .catch((e) => console.error(e));
}, []);
```

```ts
// src/workers/csv.worker.ts
case 'warm-wasm': {
  if (!wasmInitialized) {
    await initWasm();
    wasmInitialized = true;
  }
  postMessage({ type: 'dev-log', level: 'info', message: 'wasm-ready' });
  return;
}
```

Add tests: unit test that `warm-wasm` returns, and integration test that the `wasm-ready` event is emitted quickly.

---

### Add Headers-only Parse API

1. Extend the parse handler in `src/workers/handlers/parse.ts` to accept a `headers_only` boolean.
2. Implement a fast path in `src-wasm/src/parse.rs` that reads only the first line (or does a small sample scan) and returns column names, sample rows, sample column types, and a `maybeHasHeaders` meta.
3. Use `headers_only` in UI header detection flows (`src/routes/index.tsx`) where currently the UI calls a full parse.

Code snippet (worker handler):

```ts
case 'parse': {
  const { csv, headers_only } = data;
  const result = parse_csv(csv, headers_only); // new arg
  postMessage({ type: 'parse-complete', data: result });
  return;
}
```

Code snippet (WASM parse path pseudo-Rust):

```rust
pub fn parse_csv_internal_with_options(csv: &str, headers_only: bool) -> Result<ParseResult, String> {
  if headers_only {
    // read only header row (or sample rows) - fast path
  } else {
    // full parse
  }
}
```

Test: Verify `parse(..., { headers_only: true })` returns only headers and small sample rows; ensure it runs much faster than full parse on test datasets.

---

### Add Parse Progress Events (Streaming Parse)

1. Add `parse_csv_with_progress` in `src-wasm/src/parse.rs` that reads rows in streaming fashion and calls `on_progress(percent, message)` every N rows (where `progress_update_interval` is configurable).
2. Modify `src/workers/handlers/parse.ts` to pass callbacks to WASM and forward `progress` messages to the main thread via `postMessage({ type: 'progress', data: { percent, message } })`.
3. Update `useCsvWorker` to accept `onProgress` callbacks for parse calls.

Pseudo-code (Rust):

```rust
pub fn parse_csv_with_progress(csv: &str, progress_cb: Option<&Function>) -> Result<ParseResult, String> {
  let iter = csvReader.into_records().enumerate();
  let total_rows = // estimate or compute
  for (i, record) in iter {
    // accumulate
    if i % progress_interval == 0 {
      let percent = (i as f64 / total_rows as f64) * 100.0;
      progress_cb.map(|f| f.call(&JsValue::NULL, &JsValue::from_f64(percent), &JsValue::from_str("Parsing rows...")));
    }
  }
  // return full parse
}
```

Test: Parse a large CSV and ensure `onProgress` produces multiple progress events.

---

### Medium parse option: sample-first + background parsing (recommended)

Goal: Provide a middle ground between `headers_only` (very fast but limited) and a full-blocking parse by returning a quick, accurate sample and starting the diff earlier while the rest of the file is parsed in the background.

Why: For many large datasets, users care about seeing early differences rather than waiting for a full parse. By parsing a sample (e.g., first 1000 rows or a selected chunk size) we can start compare operations, provide meaningful early progress, and continue parsing in the background and stream incremental matches as they become available.

Approach:

- Add `parse_mode` or `sampleSize` options to the `parse` endpoint (e.g., `parse(text, name, hasHeaders, { sampleSize: 1000 })`).
- If `sampleSize` is provided:
  1.  Parse headers and the first `sampleSize` rows synchronously and respond with `headers`, `rows` (samples), and `estimatedRows` if possible.
  2.  Kick off a background parse (in the worker/WASM) that reads the remaining rows in chunks and emits `progress` and partial `parse-chunk-complete` events. Parsed chunks are stored in worker or WASM memory for later use.
  3.  When `compare` is requested, allow `compare` to start with the `sample` parse data and return `partial` results quickly. Compare continues to update with results from subsequent chunked parse/compare operations.

Files to modify:

- `src/hooks/useCsvWorker.ts`: accept `parse(..., options)` with `sampleSize` and `onProgress` callbacks.
- `src/workers/handlers/parse.ts`: add `sampleSize` handling, return immediate sample response and continue parse on background task.
- `src/workers/handlers/compare.ts`: support compares that accept either `sourceParsed`/`targetParsed` partial results or pointers to worker/WASM persisted parsed data.
- `src-wasm/src/parse.rs`: add `parse_sample` and `parse_remaining_in_chunks` exposures with `on_progress` callback.
- `src-wasm/src/core.rs`: add streaming compare entry points that can initially operate on partial data and accept more data over time.

Acceptance Criteria:

- `parse(text, ..., { sampleSize: n })` returns quickly with header and sample rows.
- `compare` is able to start with sample data and returns early partial results while continuing to process the remainder.
- UI shows immediate progress and early diff results; subsequent chunked parse/comparisons produce incremental updates until final `compare-complete` is received.

Pseudo-code (worker-side):

```ts
case 'parse': {
  const { csv, sampleSize = 0, headers_only = false } = data;
  if (headers_only) { /* fast path */ }
  if (sampleSize > 0) {
    const sample = parse_csv_sample(csv, sampleSize);
    postMessage({ type: 'parse-complete', data: sample }); // initial fast response
    // start background parsing task
    scheduleBackground(() => parse_and_store_remaining(csv, sampleSize, sampleId));
    return;
  }
  // fallback: full parse
}
```

Pseudo-code (WASM):

```rust
#[wasm_bindgen]
pub fn parse_csv_sample(csv: &str, sample_size: usize) -> Result<JsValue, JsValue> {
  // Parses headers + first sample_size rows
}

#[wasm_bindgen]
pub fn parse_remaining_chunks(csv: &str, offset: usize, chunk_size: usize, on_progress: &Function) {
  // Parse the rest in chunks and call on_progress per chunk
}
```

Design considerations & trade-offs:

- The correctness of partial compares must be clearly labeled as "partial" and later reconciled (e.g., row matches may change when full data is available).
- Duplicate or out-of-order updates should be handled gracefully by the UI (merge results or replace only affected rows).
- Worker memory usage: parsed sample + in-progress parsed chunks are stored — ensure memory release and `clearParsed` APIs.

Testing & instrumentation:

- Add a Playwright benchmark scenario where `parse(..., sampleSize=5000)` is performed and `compare` runs on a large dataset, recording `timeToFirstNonZeroProgress` vs `timeTo30Percent` and total compare time.
- Unit test the `parse_sample` returns correct headers and rows and that the background parse emits consistent incremental `parse-chunk-complete` events.
- Record `parseSampleTime` and `timeParsingRemaining` metrics for better comparison.

Complexity & Risk: Medium

- Moderate implementation complexity: worker & WASM changes + UI merge logic.
- Not a breaking change if operable via optional `sampleSize` flag. Provide backward compatibility.

---

### Avoid Double Parsing — Persist Parsed State

1. Add a `persistParsed` or `initDiffer(parsedRows)` worker message; store the parsed rows inside WASM (as memory structures) or worker-level caches.
2. After persistence, `compare` should look for the persisted parsed state and use it rather than re-parsing raw CSV strings.
3. Implement cleanup & memory usage guards; allow `clearParsed` or `releaseDiffer` messages.

Alternatives: Instead of storing the parsed rows in WASM memory, the UI can move to pass batch-encoded binary row buffers using transferable `ArrayBuffer`s to the worker using `postMessage`, which ongoing zero-copy in the worker-side WASM API can decode.

Complexity: This is a larger API change — it requires thorough testing & memory management.

---

### Use Chunked Diffs (`initDiffer` + `diff_chunk`) for Incremental Progress

1. Add `initDiffer(parsedSourcePtr, parsedTargetPtr)` to WASM to build an internal differ state and index. This can optionally be a `persistParsed` + `initDiffer` combination.
2. Add `diff_chunk(start, chunk_size)` that processes one chunk and returns partial `DiffResult`. It should also call `on_progress(...)` frequently.
3. Worker-side: Add `compare-chunked` handler that loops calling `diff_chunk(...)` and `postMessage` partial results.
4. UI: Update `useCsvWorker` & `route` code to load partial results, update the UI incrementally, and show progress.

Benefits: Users see partial results earlier; it reduces memory pressure and CPU burst.

---

## Instrumentation & Metrics to Add

- Basic timings:
  - `wasmInitTime`: measure full init time from first worker warm to `initWasm` completion
  - `parseTime` per file (source, target)
  - `comparePreprocessTime` and `compareMatchTime`
  - `timeToFirstProgress`: time from `compare` request to first `progress` message from worker
  - `timeTo30Percent` & `totalDiffTime`

- Progress & phases: ensure WASM emits named phases such as:
  - "Parsing source CSV"
  - "Parsing target CSV"
  - "Building fingerprint index"
  - "Matching rows"
  - "Processing remaining rows"

- Tests & scripts:
  - Create a `scripts/benchmark-parsing.js` that times `warm-wasm`, `parse(headersOnly=true)`, `parse(full)`, `compare` for a series of files under `testfiles/`.

---

## Quick Validation & Benchmark Steps

Run dev server locally:

```bash
# dev server (port 3000)
npm run dev
```

Manual tests using testfiles (example):

1. Warm WASM:

```bash
# warm WASM by opening the app or calling the worker warm message
# check console: 'wasm-ready' dev-log event
```

2. Measure parse time & progress for a large csv file (100k/1M rows):

- Use `parse(full)` and `parse(headers_only=true)` flows and record times.

3. Run the compare both with the current full diff (for baseline) and with the streaming chunked approach (after implemented) and record timings.

Automation tests (fast commands):

````bash
# use Node benchmarks or small test harness
node tools/benchmark/parse-bench.js --file testfiles/100000_A.csv
node tools/benchmark/compare-bench.js --source testfiles/100000_A.csv --target testfiles/100000_B.csv

Playwright benchmark harness:

1. The repo includes a Playwright example test demonstrating an automated benchmark that uploads CSV files and records time-to-first-progress and time-to-30%.
  - Path: `scripts/benchmark/playwright/time-to-30.spec.ts`
2. A README with instructions is available in `scripts/benchmark/README.md`.
3. Use the following command to run the test (ensure dev server is running):

```bash
BASE_URL=http://localhost:3000/csv-diff-viewer/ \
SOURCE_CSV=testfiles/100000_A.csv \
TARGET_CSV=testfiles/100000_B.csv \
npx playwright test scripts/benchmark/playwright/time-to-30.spec.ts --project=chromium
````

````

---

## Example Developer Checklist for PRs

- Add a unit test for `headers_only` that asserts the response only contains headers & first N rows
- Add a performance test for parse with progress messages
- Add `warm-wasm` integration test that asserts `wasm-ready` is logged and the next worker operation is fast
- Add a manual test for `diff_chunk` streaming (UI should show progress updates and partial results)
- Add e2e test for 1M row files using a headless Vite + puppeteer runner (optional)

---

## Risks & Considerations

- Memory impact: Storing parsed CSV in WASM memory may increase memory usage; ensure we add cleanup APIs, or use streaming to avoid bursts.
- Cross-origin isolation (COOP/COEP) and thread pools: Pre-warming and thread pool initialization require correct server/headers if we are relying on shared array buffers or SIMD. Ensure local dev & deploy flows support this.
- Backwards compatibility for worker request formats: Use `version` field to avoid breaking consumers or create fallbacks for older API path names.
- Thread pool & web worker library details: wasm-bindgen + rayon require a certain initialization procedure (e.g., the wasm-worker glue script) - ensure warm-up calls follow the expected pattern.

---

## Next Steps (Suggested Implementation Order)

1. Instrumentation & warm-up (`wasmInitTime`) — quick baseline
a. Add `warm-wasm` message
b. Add timing metrics
2. Add `headers_only` parse and use it for UI
3. Add parse progress streaming and callbacks
4. Medium-term: add `persistParsed` + `initDiffer` to avoid re-parsing
5. Use `diff_chunk` for streaming diffs and partial results
6. Optional: Add UI toggles for streaming vs full mode and `chunk_size` options

---

## Notes & Helpful File References

- Worker bootstrap: `src/workers/csv.worker.ts`, `src/workers/handlers/*.ts`
- Worker API wrapper: `src/hooks/useCsvWorker.ts` and `src/workers/wasm-context.ts`
- WASM paths and APIs: `src-wasm/src/parse.rs`, `src-wasm/src/core.rs`, `src-wasm/src/primary_key.rs`, `src-wasm/src/content_match.rs`, `src-wasm/src/streaming.rs`, `src-wasm/src/wasm_api.rs`
- UI entry points: `src/routes/index.tsx`, `src/components/DiffTable.tsx` (rendering & virtualizer), `src/components/PerformanceDashboard.tsx`
- Streaming & IndexedDB: `src/lib/indexeddb.ts` (if present) and worker streaming handlers

---

## Appendix: Example Code Snippets

Warming the WASM on mount (hook example):

```ts
// src/hooks/useWorkerStatus.ts (example)
useEffect(() => {
  let cancelled = false;

  worker.request({ type: 'warm-wasm' })
    .then(() => { if (!cancelled) setWasmReady(true); })
    .catch(e => console.warn('WASM warm failed', e));

  return () => { cancelled = true; };
}, []);
````

Parsing with `headers_only` flag (worker API):

```ts
const headers = await worker.request({
  type: "parse",
  data: { csv: csvText, headers_only: true },
});
```

Parsing with progress (worker & UI example):

```ts
const parsePromise = worker.request({
  type: "parse",
  data: { csv: csvText, headers_only: false },
  onProgress: (p) => setParseProgress(p),
});
```

WASM parse streaming (Rust pseudo):

```rust
pub fn parse_csv_with_progress(csv: &str, progress_cb: Option<&Function>) -> Result<ParseResult, JsValue> {
    let rdr = csv::Reader::from_reader(csv.as_bytes());
    let total_rows = ...; // try estimate or compute
    for (i, record) in rdr.records().enumerate() {
        if i % 1000 == 0 {
            let percent = i as f64 / total_rows as f64 * 100.0;
            if let Some(cb) = progress_cb { cb.call(...); }
        }
        // parse record into wasm memory structures.
    }
    Ok(ParseResult { ... })
}
```

---

## Final Notes

- These changes are designed to be incremental. Start with warm-up + headers-only + parse progress to get immediate UX wins.
- Persisted parsed state and chunked diffs provide the best long-term user experience, especially for datasets >100k rows.
- Instrumentation and metrics are essential to validate progress and prioritize additional work.

If you'd like, I can now produce a detailed PR plan and code for the first two items (warm WASM + header-only parse), or implement the instrumentation change — tell me which option you'd prefer and I will prepare a PR and helper tests (or continue documenting additional details).

---

## Implementation Status

### ✅ Completed Tasks

1. **Add WASM pre-warming on app startup**
   - Added `warm-wasm` worker message handler
   - Added `warmWasm()` function to useCsvWorker hook
   - Added warm-wasm call on component mount in routes/index.tsx
   - Benefits: Removes first-request WASM fetch/initialization from critical path

2. **Add headers-only parse API**
   - Added `parse_csv_headers_only()` function in WASM API
   - Added `headersOnly` option to worker parse handler
   - Updated useCsvWorker hook to support headersOnly parameter
   - Benefits: Faster header detection without full parsing

3. **Add parse progress callback**
   - Added `parse_csv_with_progress()` function in WASM API
   - Added `withProgress` option to worker parse handler
   - Updated UI to show progress during parsing operations
   - Benefits: Users see progress during large file parsing

4. **Update UI to use headers-only parse for header detection**
   - Modified handleSourceChange and handleTargetChange to use headers-only parsing
   - Benefits: Eliminates unnecessary full parsing during header detection

5. **Add instrumentation and metrics collection**
   - Created performance-metrics.ts with MetricsCollector class
   - Added timing for WASM init, parse operations, and compare operations
   - Added metrics logging to console
   - Benefits: Enables measurement of optimization effectiveness

### 🔄 Future Work (Not Yet Implemented)

- Avoid Double Parsing: Persist parsed state in worker/WASM
- Use streaming/diff_chunk for incremental compare
- Expose runtime tuning parameters to UI
- Extend performance dashboard UI to visualize new metrics

## Summary

The implemented improvements focus on reducing time-to-30% perceived startup latency by:

1. Pre-warming WASM to remove initialization from critical path
2. Using headers-only parsing for faster header detection
3. Adding progress callbacks during parsing to improve perceived performance
4. Collecting metrics to measure and optimize performance

These changes provide immediate UX wins and lay groundwork for more substantial architectural improvements.

End of document: `docs/TIME_TO_30_IMPROVEMENTS.md`
