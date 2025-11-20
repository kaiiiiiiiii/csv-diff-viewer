# CSV Diff Viewer - AI Agent Instructions

## Project Overview

High-performance CSV comparison tool built with **React**, **TypeScript**, and **Rust (WebAssembly)**. Uses a hybrid architecture where heavy computational tasks are offloaded to a Web Worker and Rust WASM module for optimal performance.

## Architecture & Data Flow

### WASM-First Comparison Engine

Two comparison modes, both implemented in Rust WASM for performance:

- **Primary Key Mode**: Uses `diff_csv_primary_key()` in WASM. Map-based lookups for datasets with unique identifiers.
- **Content Match Mode**: Uses `diff_csv()` in WASM. Inverted index and similarity scoring for heuristic matching without IDs.
- **Note**: Pure TypeScript fallbacks removed - all comparison now uses Rust WASM.

### Threading Model

- **Main Thread**: UI rendering, user input, file reading via File API. **NEVER** perform heavy CSV parsing/comparison here.
- **Web Worker** (`src/workers/csv.worker.ts`): Orchestrates all CSV operations, lazy-loads WASM module, handles progress callbacks.

### Data Flow Pattern

```
UI (useCsvWorker hook)
  → Worker (csv.worker.ts)
    → WASM (diff_csv/diff_csv_primary_key) 
      → DiffResult back to UI via structured cloning
```

## Critical Developer Workflows

### Build Commands

```bash
# Development
npm run dev                    # Start Vite dev server (port 3000) with TanStack Start

# WASM builds (required after Rust changes)
npm run build:wasm            # Build Rust → WASM (requires wasm-pack)
npm run build                 # Full build: WASM → optimized client bundle
npm run serve                 # Preview production build locally

# Quality checks  
npm test                      # Run Vitest unit tests
npm run lint                  # ESLint checks
npm run format                # Prettier formatting  
npm run check                 # Format + lint fix (combined command)
```

### WASM Development

- **Always run `npm run build:wasm`** after modifying `src-wasm/src/lib.rs`
- Rust code uses `wasm-bindgen` for JS interop
- Pass raw strings to WASM (avoid large JS objects for performance)
- Progress callbacks use JS `Function` parameter for UI updates

## Code Conventions & Patterns

### TypeScript Patterns

**Heavy use of `any` type**: The codebase intentionally uses `any` for performance-critical code (20+ instances). This is intentional for:

- Dynamic row data structures (`Array<any>` in DiffResult)
- Worker message passing
- Performance-sensitive comparison loops

**Example from `comparison-engine.ts`**:

```typescript
export interface DiffResult {
  added: Array<any> // Intentional: flexible row structures
  removed: Array<any>
  modified: Array<any>
  unchanged: Array<any>
}
```

### Web Worker Communication

**Request/Response Pattern** (`useCsvWorker.ts`):

- Each request has unique `requestId` for correlation
- Progress callbacks for UI updates
- Explicit error handling with `type: 'error'` messages

**Worker Implementation** (`csv.worker.ts`):

```typescript
ctx.onmessage = async function (e) {
  const { requestId, type, data } = e.data || {}
  // Always validate requestId
  // Use progress callbacks: emitProgress(percent, message)
  // Send errors: ctx.postMessage({ requestId, type: 'error', data })
}
```

### Performance Optimizations

**WASM-First Processing**:

- All comparison logic moved to Rust WASM for optimal performance
- Progress reporting via JS callback functions for UI responsiveness
- Raw CSV strings passed directly to WASM (avoids JS object serialization overhead)

**Virtualized Rendering** (`DiffTable.tsx`):

- Uses `@tanstack/react-virtual` for large datasets
- Sticky headers with shadow effects
- Dynamic row heights with `estimateSize: 50px`
- Fullscreen and expanded view modes

**WASM Optimization** (`src-wasm/src/lib.rs`):

- Inverted index for content matching (O(1) lookups)
- HashMap-based primary key matching
- Chunked progress reporting (every N iterations)
- Optimized string similarity algorithms

### Component Architecture

**UI Components** (`src/components/`):

- `DiffTable.tsx`: Virtualized table with fullscreen/expand modes, uses @tanstack/react-table + @tanstack/react-virtual
- `ConfigPanel.tsx`: Comparison mode selection, column configuration, match options
- `CsvInput.tsx`: File upload and direct text input with example data loader
- Uses **shadcn/ui** + **Radix UI** components (Button, Card, Input, Switch, etc.)

**State Management**:

- Local React state for UI (comparison mode, filters, view options)
- Web Worker for all data processing (never block main thread)
- Results cached in component refs for scroll position preservation

### Comparison Algorithms

**Primary Key Mode** (`compareByPrimaryKey`):

1. Build Map of source rows keyed by composite key
2. Build Map of target rows (validate uniqueness)
3. Find removed: keys in source but not target
4. Compare target rows: added/modified/unchanged
5. Parallel batch processing for steps 1-2 and 3-4

**Content Match Mode** (`diff_csv_internal`):

1. Build fingerprint lookup for exact matches
2. Build inverted index for similarity search
3. For each source row: try exact match → similarity match → removed
4. Remaining target rows are added

## Critical Files

- **`src/workers/csv.worker.ts`**: Worker orchestration, WASM lazy-loading, progress callbacks
- **`src/lib/comparison-engine.ts`**: TypeScript type definitions for DiffResult and interfaces
- **`src-wasm/src/lib.rs`**: Rust WASM implementation, inverted index, similarity matching
- **`src/hooks/useCsvWorker.ts`**: Worker communication hook, request/response correlation
- **`src/components/DiffTable.tsx`**: Virtualized table, fullscreen mode, filtering
- **`vite.config.ts`**: WASM plugin configuration, TanStack Start setup

## Error Handling Patterns

**Worker Errors**:

```typescript
try {
  // comparison logic
} catch (error: any) {
  ctx.postMessage({
    requestId,
    type: 'error',
    data: { message: error.message, stack: error.stack },
  })
}
```

**UI Error Display**:

```typescript
} catch (e: any) {
  alert('Error: ' + e.message)  // Simple error display
}
```

## Testing Approach

- **Unit Tests**: `npm test` runs Vitest
- **WASM Tests**: Rust tests in `src-wasm/src/lib.rs` (see `#[cfg(test)]`)
- **Integration**: Test via browser with example data (Load Example button)

## Common Tasks

**Adding New Comparison Option**:

1. Add to `ConfigPanel.tsx` (UI control)
2. Add to `useCsvWorker.compare()` options
3. Pass through worker to comparison functions
4. Implement in both TS (`comparison-engine.ts`) and WASM (`src-wasm/src/lib.rs`)

**Performance Issues**:

1. Check if raw CSV strings available (enables WASM)
2. Verify batch sizes in comparison algorithms
3. Ensure UI yields with `setTimeout(r, 0)` in loops
4. Consider virtualized rendering for large results

**Debugging WASM**:

1. Check browser console for Rust panics
2. Verify `npm run build:wasm` completed successfully
3. Test with simple data first
4. Check progress callback messages
