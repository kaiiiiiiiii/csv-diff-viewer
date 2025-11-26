# Parallel Threading — Next Improvements

This document captures decisions, next improvements, and actionable items for improving the threading, chunking, and performance reporting in the csv-diff-viewer project. Use it as a living checklist and reference for future PRs.

---

## Background & Current State

- Problem: The Performance Dashboard showed each worker thread as handling the entire dataset (e.g., "10k / 10k") rather than each showing their portion of work. This made the dashboard misleading and unnecessarily confusing.
- Cause: The worker callback used global progress percent (and global item counts derived from percent) and emitted identical progress info for each thread. The same `percent` and calculated `itemsProcessed = Math.floor((percent/100) * totalRowCount)` was passed by the callback for all threads.
- Fix (applied): Per-thread counters were implemented in the Rust parallel logic (inside `src-wasm/src/parallel.rs`) and it now emits `THREAD_PROGRESS|<id>|<processed>|<perThreadTotal>` messages in addition to global progress. The worker `compare.ts` parses those messages and emits per-thread status updates. The UI updates a single thread entry instead of showing repeated global counts.

---

## Goal

- Improve accuracy of per-thread progress reporting.
- Maintain backward-compatibility and provide a safe fallback when per-thread messages are not emitted.
- Improve overall parallel performance by: 1) configuring the Rust rayon pool to match the UI intended thread count and 2) tuning chunk size dynamically for high throughput with low overhead.

---

## Prioritized Next Improvements (organized by priority)

### 0 — Immediate improvements (safe, low risk)

- [ ] Standardize and document the THREAD_PROGRESS protocol (or switch to JSON message) in `parallel.rs` and `compare.ts`.
  - Proposed format: `THREAD_PROGRESS|<threadId>|<processed>|<perThreadTotal>` (current), OR JSON: `THREAD_PROGRESS_JSON|{"threadId": 0, "processed": 50, "perThreadTotal": 125}`.
  - Implement both old string and new JSON formats for compatibility during rollout.

- [ ] Emit exact per-thread totals from Rust (instead of `ceil(totalRows / numThreads)` in JS). Update `THREAD_PROGRESS` messages to include accurate per-thread totals.

- [ ] Add a more explicit progress event `THREAD_STATUS` that optionally includes additional diagnostics such as per-thread CPU time, memory usage, and last operation.

### 1 — Short-term changes (1-2 sprints)

- [ ] Make the primary-key parallel function use the parallel algorithm (we already routed `diff_csv_primary_key_parallel` to use `parallel.rs`, but double-check result correctness and test coverage).
- [ ] Implement dedicated per-thread progress update intervals (avoid spamming UI) — emit per-thread messages on chunk boundaries and only when counts change by a configured minimum share.
- [ ] Confirm that per-thread counters and message emission are atomic-safe and do not cause race conditions; add tests.

### 2 — Mid-term changes (2-4 sprints)

- [ ] Implement `init_thread_pool(num)` backed by `rayon::ThreadPoolBuilder` and an exported wasm API to allow JS to configure the thread count before invoking parallel jobs. Integrate with `navigator.hardwareConcurrency - 1` and allow the end user/QA to override.
- [ ] Add `use wasm-bindgen-rayon` (already used in build) to coordinate JS and rust rayon thread pool. Document build and wasm-pack flags required.
- [ ] Implement adaptive chunk size (auto-tune) based on dataset size and thread count and provide a threshold to prevent too many small tasks that cause overhead.
- [ ] Add proper CPU/memory profiling hooks in `parallel.rs` and the JS worker — gather per-thread timing statistics so we can compare workload distribution.

### 3 — Long-term changes (4+ sprints)

- [ ] Revisit design decisions to implement streaming and merging results per chunk (the streaming module already exists) in parallel — this can avoid large allocations for very large datasets.
- [ ] Introduce performance benchmarking harness in Rust and JS to systematically benchmark across `testfiles/` dataset sizes and different hardware.
- [ ] Add a telemetry view in Performance Dashboard that shows average per-thread CPU & memory use, chunk processing times, and hot-spot column comparison durations.

---

## Implementation Notes & File Mappings

Files you likely will edit:

- WASM/Rust:
  - `src-wasm/src/parallel.rs` — per-thread chunk processing, counters, thread progress emission, fuzzy matching loop, chunk size constants.
  - `src-wasm/src/wasm_api.rs` — The wasm entry points for binary and JSON diff functions. Ensure parallel functions are backed by `parallel.rs` and not by `core.rs` where single-threaded logic exists.
  - `src-wasm/src/wasm_tests.rs` — add tests verifying per-thread progress messages and correct result counts, and a small harness to run `parallel::` functions with small CSVs verifying `THREAD_PROGRESS` messages exist.

- Worker/TS:
  - `src/workers/handlers/compare.ts` — parse `THREAD_PROGRESS` messages; update per-thread status; emit initial per-thread totals; fallback to global percent when needed.
  - `src/workers/wasm-context.ts` — optional: provide `initWasmThreadPool` to set `rayon` pool size via an exported wasm function.
  - `src/hooks/useWorkerStatus.ts` — update the model to store `lastActivityTimestamp`, thread `elapsedMs` to visualize throughput.

- UI:
  - `src/components/PerformanceDashboard.tsx` — use `itemsProcessed` / `totalItems` for the per-thread progress bar; add per-thread timing metrics.

---

## Tests & Validation

### Unit & Integration Tests

- Rust/wasm tests:
  - Add a `#[test]` asserting per-thread progress strings are emitted (like `THREAD_PROGRESS|`), and that thread counters increase correctly.
  - Add a `#[test]` that runs `diff_csv_content_match_parallel` on tiny CSVs and confirms at least one `THREAD_PROGRESS` occurred and results are identical to the single-threaded version.
  - Add CI tests against `src-wasm/wasm_tests.rs` to verify parallel functionality remains deterministic for small testcases.

- JS/TypeScript tests:
  - Unit test `compare.ts`'s callback wrapper for parsing `THREAD_PROGRESS` messages. Provide test harness to emit synthetic messages and test that only correct thread updates are emitted.
  - `useWorkerStatus.ts` tests to ensure `updateThreadStatus` only modifies the intended thread and merges new data correctly.

### Manual/Dev tests

- Validate the dashboard shows realistic per-thread counts:
  - Dataset: `testfiles/10000_A.csv` and `10000_B.csv`
  - UI: Start Content Match with `USE_PARALLEL_PROCESSING` and watch the threads in Performance Dashboard.
  - Confirm that the sum of `itemsProcessed` across threads roughly equals processed keys; and each thread's `totalItems` is a reasonable share.

---

## Benchmarking & Tuning commands

- Common build & dev commands (use fish-compatible syntax if needed):

```fish
# Build wasm package for release (rayon-friendly build)
npm run build:wasm

# Start Vite dev server
npm run dev

# Lint & check types
npm run check

# Run unit tests for Rust
cd src-wasm
cargo test --release

# Run wasm tests: (may require target wasm32 and wasm-bindgen test harness)
# Cross compile or run rust tests directly for native validation
cargo test --release -- --nocapture --ignored
```

- Benchmarks to run manually:

Use the `Performance Dashboard` with these files while toggling `USE_BINARY_ENCODING` and `USE_PARALLEL_PROCESSING`.

- Step 1: Compare `10000_A.csv` / `10000_B.csv` with `Content Match` and `Parallel` enabled.
- Step 2: Note wall-clock time and memory usage from the dashboard.
- Step 3: Repeat with `Binary` encoding to compare improvement.
- Step 4: Repeat with `Primary Key` mode for `100k` rows if you want to measure map-based workloads.

Capture/process: The dashboard logs and browser devtools or `console` should be used; for reproducible benchmarking, capture start and end timestamps and average CPU/time over several runs.

---

## Migration & Backwards Compatibility

- New per-thread messages are additive — old messages remain supported: worker fallback still emits a global update.
- Changes are additive and should not break non-parallel runs.

---

## Open Questions & TODOs

- Are we ready to switch to JSON-style per-thread progress messages? It is more robust for future fields but would require small parsing changes in `compare.ts`. -> yes
- Do we want to propagate per-thread performance (e.g., processing time and count) to the final `compare-complete` results for detailed offline analysis? -> yes

---

## Notes & References

- Files touched in the initial patch: `src-wasm/src/parallel.rs`, `src-wasm/src/wasm_api.rs`, `src/workers/handlers/compare.ts`, `src-wasm/src/wasm_tests.rs`.
- See `refactor/rayon_shared_memory.md` for historical notes on WASM multithreading with shared memory.
- The UI uses `useWorkerStatus` and `PerformanceDashboard` to visualize thread progress.

---

## Prioritized tasks to start with (actionable)

1. (Immediate) Document `THREAD_PROGRESS` format and add typed/JSON format fallback support in `compare.ts`.
2. (Immediate) Use exact per-thread totals in `THREAD_PROGRESS` (Rust should compute it based on assigned keys/rows during map building).
3. (Short-term) Implement `init_thread_pool(numThreads)` and wire it into `diff_csv_parallel_binary` and `diff_csv_primary_key_parallel` entry paths in `wasm_api.rs`.
4. (Short-term) Add tests in `src-wasm/src/wasm_tests.rs` for `THREAD_PROGRESS` validation.
5. (Mid-term) Implement adaptive chunk sizes, with a dev toggle to enable/disable to measure impact without code changes.
6. (Mid-term) Add per-thread CPU/memory profiling and logging to debug skewed load distributions.

---

If you'd like, I can begin with item 1: making `THREAD_PROGRESS` more robust and add tests. Which item would you like me to start with next?
