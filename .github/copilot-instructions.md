# CSV Diff Viewer - AI Agent Instructions

## Project Overview

This is a high-performance CSV comparison tool built with **React**, **TypeScript**, and **Rust (WebAssembly)**. It uses a hybrid architecture where heavy computational tasks are offloaded to a Web Worker and, for specific modes, to a Rust WASM module.

## Architecture & Data Flow

### 1. Hybrid Comparison Engine

The application supports two comparison modes with different execution paths:

- **Primary Key Mode**: Executed in **TypeScript** within the Web Worker. Best for datasets with unique identifiers.
- **Content Match Mode**: Executed in **Rust (WASM)** within the Web Worker. Best for heuristic matching of rows without IDs.
  - _Fallback_: Falls back to TS implementation if raw CSV strings are unavailable.

### 2. Threading Model

- **Main Thread**: Handles UI rendering, user input, and file reading. **NEVER** perform heavy CSV parsing or comparison here.
- **Web Worker** (`src/workers/csv.worker.ts`): Orchestrates the comparison process. It lazy-loads the WASM module and communicates progress back to the main thread.

### 3. Data Flow

1.  **UI**: User selects files -> `useCsvWorker` hook sends data to Worker.
2.  **Worker**: Receives `source` and `target` data.
    - If `content-match`: Calls `diff_csv` (WASM).
    - If `primary-key`: Calls `compareByPrimaryKey` (TS).
3.  **Result**: Worker posts `DiffResult` back to UI for rendering.

## Developer Workflow

### Build & Run

- **Dev Server**: `npm run dev` (starts Vite).
- **Wasm Build**: `npm run build:wasm` (requires `wasm-pack`).
  - _Note_: You must run this if you modify `src-wasm/`.
- **Full Build**: `npm run build` (builds Wasm -> then Client).

### Testing

- **Unit Tests**: `npm test` (Vitest).

## Code Conventions

### WebAssembly (Rust)

- Located in `src-wasm/`.
- Use `wasm-bindgen` to expose functions to JS.
- **Performance**: Avoid passing large JS objects to Wasm. Pass raw strings or flat arrays when possible to minimize serialization overhead.
- **Panic Handling**: Ensure Rust panics are caught or handled gracefully to prevent crashing the worker.

### Web Worker

- Located in `src/workers/`.
- Use `postMessage` for communication.
- Always include a `requestId` in messages to correlate requests/responses.
- Handle errors explicitly and send `type: 'error'` messages back to the main thread.

### Frontend (React)

- **Routing**: Uses **TanStack Router** (`src/routes`). File-based routing.
- **State**: Local state for UI; Worker for data processing.
- **Styling**: **Tailwind CSS** with **shadcn/ui** components (`src/components/ui`).
- **Components**:
  - `DiffTable.tsx`: Virtualized table for displaying results (TanStack Virtual).
  - `ConfigPanel.tsx`: Settings for comparison.

## Critical Files

- `src/workers/csv.worker.ts`: Central hub for comparison logic orchestration.
- `src/lib/comparison-engine.ts`: TypeScript implementation of comparison algorithms.
- `src-wasm/src/lib.rs`: Rust implementation of the content matching algorithm.
- `docs/wasm-integration.md`: Detailed documentation on the Wasm architecture.
- `vite.config.ts`: Configuration for Vite and Wasm plugins.
