# Rust WASM Integration for CSV Diff Viewer

This document outlines the integration of a Rust WASM module to optimize the "unmatched" (content match) comparison mode for large CSV files.

## Architecture

The application uses a hybrid approach:

1.  **JavaScript (Main Thread)**: Handles UI, file input, and result rendering.
2.  **Web Worker**: Orchestrates the comparison process to keep the UI responsive.
3.  **Rust WASM**: Performs the heavy lifting for $O(N \times M)$ content matching comparisons.

### Why WASM?

The "content match" mode (comparing rows without a primary key) requires comparing every unmatched source row against every unmatched target row. In JavaScript, this is extremely slow for datasets > 10k rows. Rust provides:

- **Performance**: Near-native execution speed.
- **Memory Efficiency**: Better memory management than JS objects.
- **Parallelism Potential**: (Future) Rayon can be used for multi-threading.

## Implementation Details

### 1. Rust Module (`src-wasm/`)

- **Crate**: `csv-diff-wasm`
- **Dependencies**: `wasm-bindgen`, `csv`, `serde`, `serde-wasm-bindgen`.
- **Function**: `diff_csv(source_csv, target_csv, ...)`
  - Parses raw CSV strings directly (avoiding JS object overhead).
  - Implements the "best match" algorithm using similarity scores.
  - Returns a `DiffResult` object compatible with the existing JS interface.

### 2. Build Process

- **Tool**: `wasm-pack` builds the Rust code into a WebAssembly module.
- **Vite Plugins**:
  - `vite-plugin-wasm`: Loads `.wasm` files.
  - `vite-plugin-top-level-await`: Supports top-level await in the generated glue code.
- **Scripts**:
  - `npm run build:wasm`: Builds the WASM module.
  - `npm run build`: Builds WASM then the Vite app.

### 3. Worker Integration (`src/workers/csv.worker.ts`)

- The worker lazy-loads the WASM module using dynamic `import()`.
- When `comparisonMode` is `content-match` AND raw CSV strings are provided, it delegates to WASM.
- Otherwise, it falls back to the TypeScript implementation (e.g., for Primary Key mode).

### 4. Frontend Integration

- The `useCsvWorker` hook and `Index` component pass the raw CSV text strings to the worker alongside the parsed data.

## Development

1.  **Prerequisites**: Install Rust and `wasm-pack`.
2.  **Setup**:
    ```bash
    cargo install wasm-pack
    npm install
    ```
3.  **Run**:
    ```bash
    npm run dev
    ```
    (Note: You might need to run `npm run build:wasm` once manually if `dev` doesn't trigger it, though it's not strictly required for dev server if the pkg exists).

## Future Improvements

- **Parallelism**: Use `rayon` and `wasm-bindgen-rayon` to parallelize the matching loop in Rust.
- **Streaming**: Stream CSV parsing for files larger than memory.
- **Primary Key Mode**: Port the Primary Key mode to Rust as well for consistency (though JS is already fast enough for this).
