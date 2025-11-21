# CSV Diff Viewer - AI Coding Agent Instructions

## Project Overview

A high-performance CSV comparison tool using **Rust/WASM** for computation and **React + TanStack** for UI. The architecture prioritizes **memory efficiency** and **responsiveness** through Web Workers, chunked processing, and IndexedDB storage for large datasets.

## Core Architecture

### 3-Layer Processing Pipeline

1. **UI Layer** (`src/routes/index.tsx`): React components using TanStack Router/Table/Virtual
2. **Worker Layer** (`src/workers/csv.worker.ts`): Web Worker wrapping WASM module, handles async CSV operations
3. **WASM Core** (`src-wasm/src/`): Rust-based CSV parsing and diffing engine

**Data Flow**: User uploads CSV → Worker parses via WASM → Results stream back via postMessage → IndexedDB for chunked diffs → Virtual rendering in React

### Two Comparison Modes

- **Primary Key Mode** (`diff_csv_primary_key_internal`): Uses specified columns as unique identifiers, builds HashMaps for O(1) lookups
- **Content Match Mode** (`diff_csv_internal`): Fuzzy matching using Jaro-Winkler similarity (threshold 0.5), fingerprinting for exact matches first

Both modes support: case sensitivity, whitespace normalization, empty vs null equivalence, column exclusion

## Key Conventions & Patterns

### Rust/WASM (src-wasm/)

- **Follow `.github/instructions/rust.instructions.md`** for all Rust code
- All public WASM functions use `JsValue` for JS interop, serialize with `serde-wasm-bindgen` in JSON-compatible mode
- Progress callbacks: `on_progress: &Function` receives `(f64, &str)` for percent/message
- Error handling: Return `Result<JsValue, JsValue>` with descriptive string errors
- Performance optimizations in `Cargo.toml`: `opt-level='z'`, `lto=true`, `codegen-units=1`
- Use `AHashMap`/`AHashSet` from `ahash` for faster hashing than std
- Implement tests in `lib.rs` using `#[wasm_bindgen_test]` with test data from `test_data.rs`

### TypeScript/React (src/)

- **shadcn/ui components** (New York style) via `@/components/ui/`, use `cn()` utility from `@/lib/utils` for className merging
- **Path aliases**: `@/*` maps to `src/*` (configured in tsconfig.json and vite.config.ts)
- **Strict TypeScript**: `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports` enabled
- **TanStack Virtual** for rendering large tables (see `DiffTable.tsx` rows 400-500 for virtualizer setup)
- **React Compiler** enabled via `babel-plugin-react-compiler` - write idiomatic React, avoid manual memoization
- State management: Local state with hooks, no global store (IndexedDB for persistence)

### Worker Communication Pattern

All worker requests use this structure (see `useCsvWorker.ts`):

```typescript
{
  requestId: number,  // Auto-incremented counter
  type: 'parse' | 'compare' | 'init-differ' | 'diff-chunk',
  data: { /* request-specific payload */ }
}
```

Responses: `{ requestId, type: 'progress' | 'error' | '*-complete', data }`

Track requests in Map with `{ resolve, reject, onProgress }` callbacks. Clean up on completion/error.

### Chunked Diff System

For datasets >10k rows (configurable `chunkSize`):

1. Initialize `CsvDiffer` instance in worker via `initDiffer()`
2. Iterate chunks: `diffChunk(chunkStart, chunkSize)` in `useChunkedDiff.ts`
3. Stream results to IndexedDB via `indexeddb.ts` manager
4. Load incrementally for rendering: `loadDiffResults(diffId, chunkIndex, chunkSize)`

**Why**: Prevents UI blocking and memory overflow on million-row CSVs. WASM state persists across chunk calls.

## Development Workflows

### Building & Running

```bash
npm run dev              # Vite dev server on :3000, hot reload
npm run build:wasm       # wasm-pack build in src-wasm/
npm run build            # Build WASM then Vite production bundle
npm run check            # Prettier + ESLint auto-fix
```

**Important**: Always rebuild WASM after Rust changes. Vite won't auto-detect changes in `src-wasm/pkg/`.

### Testing

- **Rust**: `cd src-wasm && cargo test` (unit tests in lib.rs, integration tests use test_data.rs)
- **Benchmarks**: `cargo test --release -- --ignored --nocapture` (see `.github/workflows/test.yml` line 36)
- **TypeScript**: No test framework currently configured (component tests in `src/components/__tests__/` exist but not used)

### Deployment

GitHub Actions workflow (`.github/workflows/deploy.yml`) triggers on `src/**` or `src-wasm/**` changes:

1. Build WASM with wasm-pack
2. Build app with `npm run build` (outputs to `.output/public/`)
3. Copy `index.html` to `404.html` for SPA routing
4. Deploy to GitHub Pages

**Base path**: Configured as `/csv-diff-viewer/` in `vite.config.ts` for GitHub Pages subdirectory

## Critical Implementation Details

### Auto-Header Detection

`parse_csv_internal` in `core.rs` lines 25-40: If headers look numeric/data-like, re-parse as headerless with generated `Column1`, `Column2`, etc.

### Cell Diff Rendering

`DiffTable.tsx` uses `similar` crate's output (ChangeTag enum) to show character-level diffs with colored backgrounds:

- Green: Added text
- Red: Removed text
- Yellow: Modified cells

### Memory Optimization Strategies

- Virtual scrolling via `@tanstack/react-virtual` (renders only visible rows)
- Chunked processing with IndexedDB persistence (avoids large in-memory arrays)
- WASM binary optimized to ~150KB gzipped (size tracked in CI)
- Early fingerprinting for unchanged rows (skip expensive similarity calculations)

### Styling System

- **Tailwind CSS v4** via `@tailwindcss/vite` plugin
- Custom theme in `src/styles.css` using CSS variables for dark/light mode
- `theme-provider.tsx` + `mode-toggle.tsx` for theme switching
- Component styling: Use `cn()` for conditional classes, prefer Tailwind utilities over custom CSS

## Common Pitfalls

- **Don't** call WASM functions directly from React - always proxy through worker
- **Don't** use `unwrap()` in Rust without clear justification - return `Result` with context
- **Don't** store large datasets in React state - use IndexedDB or chunked loading
- **Don't** forget to update `routeTree.gen.ts` - run `npm run dev` to auto-generate
- **Do** validate CSV headers match between source/target in content-match mode (auto-aligned in `diff_csv_internal` lines 175-180)
- **Do** use `@/` import paths for all src/ modules (not relative paths)

## Integration Points

- **WASM Module**: Loaded in worker via `import init, { ... } from '../../src-wasm/pkg/csv_diff_wasm'`
- **Vite Plugins**: `vite-plugin-wasm` enables WASM imports, `vite-tsconfig-paths` resolves `@/` aliases
- **TanStack Router**: File-based routing in `src/routes/`, auto-generates `routeTree.gen.ts`
- **IndexedDB**: Schema in `indexeddb.ts` - stores `DiffChunk` objects with compound keys `[diffId, chunkIndex]`

## Performance Benchmarks

Reference implementations in `src-wasm/src/lib.rs` (ignored tests):

- 1M rows comparison: ~3-5s (primary key mode)
- 100K rows fuzzy matching: ~10-15s (content match mode)
- Memory usage: <200MB for 1M row dataset with chunking

Track WASM binary size in CI - alert if exceeds 200KB (pre-gzip).
