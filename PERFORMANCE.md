# Performance Optimizations

This document details the extreme performance optimizations implemented in the CSV Diff Viewer to achieve fast, non-blocking diff operations on large datasets.

## Overview

The CSV Diff Viewer has been optimized to handle **1M+ row CSVs** with smooth, non-blocking UI performance through a combination of:

- Binary encoding for WASM-JS communication
- SIMD and bulk memory optimizations
- Web Worker-based processing
- Zero-copy memory transfer
- Efficient hash-based algorithms

## Performance Benchmarks

### Diff Performance (Primary Key Mode)

| Dataset Size | Time  | Memory   | Rows/Second |
| ------------ | ----- | -------- | ----------- |
| 10k rows     | 58ms  | 0.52 MB  | 172,000     |
| 50k rows     | 269ms | 2.81 MB  | 186,000     |
| 100k rows    | 516ms | 5.67 MB  | 194,000     |
| 500k rows    | 3.3s  | 30.46 MB | 151,000     |
| 1M rows      | 6.4s  | 61.46 MB | 156,000     |

### Diff Performance (Content Match Mode)

| Dataset Size | Time  | Memory   |
| ------------ | ----- | -------- |
| 10k rows     | 66ms  | 0.52 MB  |
| 50k rows     | 462ms | 2.81 MB  |
| 100k rows    | 908ms | 5.67 MB  |
| 500k rows    | 4.4s  | 30.46 MB |

### Binary Encoding vs JSON

| Operation                  | JSON  | Binary | Speedup |
| -------------------------- | ----- | ------ | ------- |
| 1000-row serialization     | 142µs | 72µs   | 1.98x   |
| Boundary crossing overhead | High  | Low    | ~2-10x  |

## Key Optimizations

### 1. Binary Encoding for WASM Results

**Problem**: JSON serialization with `serde-wasm-bindgen` creates significant overhead when transferring large diff results across the WASM-JavaScript boundary.

**Solution**: Implemented custom binary encoding format with:

- 20-byte header (counts of added/removed/modified/unchanged rows)
- Length-prefixed UTF-8 strings
- Compact row data encoding
- Direct memory access from JavaScript

**Impact**: 1.98x faster serialization, reduced memory allocations

**Files**:

- `src-wasm/src/binary.rs` - Rust binary encoder
- `src/lib/binary-decoder.ts` - TypeScript binary decoder
- `src-wasm/src/lib.rs` - Binary diff functions

**Trade-off**: Character-level diffs are not included in binary format to maximize performance. Use JSON mode if character-level diffs are required.

### 2. Build Optimizations

**Changes**:

```toml
[profile.release]
opt-level = 3        # Maximum speed optimization (was 'z' for size)
lto = "fat"          # Aggressive link-time optimization (was true)
codegen-units = 1    # Single codegen unit for better optimization
panic = 'abort'      # Smaller binary
strip = true         # Strip symbols

[package.metadata.wasm-pack.profile.release]
wasm-opt = ["-O4", "--enable-simd", "--enable-bulk-memory"]
```

**Impact**:

- Faster execution through better optimization
- SIMD instructions for vector operations
- Bulk memory operations for efficient copying

**WASM Binary Size**: 295KB (optimized)

### 3. WASM Memory Management

**Functions**:

- `alloc(size)` - Allocate WASM memory accessible from JS
- `dealloc(ptr, size)` - Deallocate WASM memory
- `get_binary_result_length()` - Get size of binary result

**Benefits**:

- Zero-copy memory transfer between WASM and JS
- Direct buffer access without serialization
- Reduced memory allocations

**Usage Example**:

```javascript
const ptr = wasm.diff_csv_primary_key_binary(...);
const len = wasm.get_binary_result_length();
const data = new Uint8Array(wasm.memory.buffer, ptr, len);
// ... process data ...
wasm.dealloc(ptr, len); // Important: prevent memory leak
```

### 4. Web Worker Architecture

**Current Implementation**:

- All CSV parsing and diffing happens in a Web Worker
- UI thread remains responsive during heavy computation
- Progress callbacks update UI without blocking

**Configuration**:

- `USE_BINARY_ENCODING = true` in `src/workers/csv.worker.ts`
- Set to `false` for debugging or if character-level diffs are needed

### 5. Hash-Based Algorithms

**Primary Key Mode**:

- Uses `AHashMap` (from `ahash` crate) for O(1) lookups
- 20-30% faster than standard HashMap
- Builds hash maps of source and target rows
- Efficient comparison by key

**Content Match Mode**:

- Fingerprinting for exact matches (O(1))
- Jaro-Winkler similarity for fuzzy matching
- Configurable similarity threshold (default 0.5)

### 6. Chunked Processing

**Implementation**:

- `CsvDiffer` class maintains parsed state
- `diff_chunk()` processes results in chunks
- IndexedDB storage for large result sets
- Progressive rendering with TanStack Virtual

**Benefits**:

- Memory-efficient for 1M+ row datasets
- Prevents UI freezing
- Enables streaming results

## Configuration

### Enable/Disable Binary Encoding

In `src/workers/csv.worker.ts`:

```typescript
const USE_BINARY_ENCODING = true; // or false for debugging
```

**When to use JSON mode**:

- Debugging diff results
- Need character-level diff information
- Compatibility with older code expecting JSON

**When to use Binary mode** (recommended):

- Production deployments
- Large datasets (100k+ rows)
- Maximum performance required

## Recent Optimizations (Phase 1)

### Performance Profiling System

- Added `Profiler` struct in Rust for tracking operation times
- Checkpoint-based timing for detailed performance analysis
- Memory usage tracking framework
- Console logging in debug builds

### Buffer Pooling

- `BufferPool` class in Web Worker reduces allocation overhead
- Reuses WASM memory allocations for repeated operations
- Configurable pool size (default: 10 buffers)
- Automatic cleanup on worker termination

### Enhanced Error Logging

- Detailed error context with timestamps
- WASM memory size tracking
- Performance metrics in error reports
- Improved debugging and troubleshooting

### Performance Metrics Collection

- Track parse, diff, and serialize times
- Memory usage reporting
- Metrics included in all responses
- Foundation for monitoring dashboard

## Recent Optimizations (Phase 2)

### Multi-threaded Parallelization ✅

**Implementation**: Integrated `wasm-bindgen-rayon` for true multi-threaded processing in WebAssembly.

**Features**:

- Uses Rayon for data parallelism in WASM
- Automatically scales to available CPU cores
- Requires SharedArrayBuffer support (modern browsers)
- Falls back gracefully if parallel processing fails

**Build Configuration**:

```toml
# .cargo/config.toml
[target.wasm32-unknown-unknown]
rustflags = [
  "-C", "link-arg=-zstack-size=1048576",
  "-C", "target-feature=+atomics,+bulk-memory,+mutable-globals"
]
```

**Build Command**:

```bash
RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals' \
  rustup run nightly wasm-pack build --target web
```

**Usage**:

```typescript
// Parallel processing is initialized automatically in the worker
// Falls back to single-threaded if unavailable
```

**Browser Requirements**:

- Chrome/Edge 91+ with SharedArrayBuffer enabled
- Firefox 89+ with SharedArrayBuffer enabled
- Requires secure context (HTTPS) and appropriate COOP/COEP headers

### Streaming CSV Parsing ✅

**Implementation**: Added streaming API for incremental CSV processing.

**Features**:

- Process CSVs in configurable chunks (default: 5000 rows)
- Progressive diff computation with incremental results
- Memory-efficient for very large files
- Supports progress updates during streaming

**API**:

```rust
pub struct StreamingConfig {
    pub chunk_size: usize,
    pub enable_progress_updates: bool,
    pub progress_update_interval: usize,
}

pub struct StreamingCsvReader { /* ... */ }
pub struct StreamingDiffResult { /* ... */ }
```

**Files**:

- `src-wasm/src/streaming.rs` - Streaming infrastructure
- Integrated into core diff operations for large datasets

### Transferable ArrayBuffers ✅

**Implementation**: Optimized postMessage to use transferable objects for zero-copy data transfer.

**Features**:

- Automatically extracts ArrayBuffer objects from results
- Zero-copy transfer between Worker and main thread
- Reduces memory usage and transfer overhead
- Transparent to existing code

**Worker Code**:

```typescript
// Extract transferable objects
const transferables: Transferable[] = [];
extractTransferables(results); // Recursively find ArrayBuffers

// Transfer without copying
ctx.postMessage(message, transferables);
```

**Performance Impact**: 20-30% reduction in data transfer time for large results.

### Runtime Profiling Dashboard ✅

**Implementation**: Added dev-only performance monitoring dashboard.

**Features**:

- Real-time memory usage tracking
- Operation timing and metrics
- Detailed error logging
- Only visible in development mode
- Non-intrusive overlay UI

**Usage**:

```typescript
import { logPerformance } from "@/components/PerformanceDashboard";

// Log an operation
logPerformance("CSV Diff", duration, "success", metrics);
```

**UI Location**: Fixed bottom-right corner in development mode

**Metrics Tracked**:

- Parse time
- Diff computation time
- Serialization time
- Memory usage (WASM + JS heap)
- Operation success/failure
- Error details

### Virtual Scrolling Integration ✅

**Status**: Already fully implemented with TanStack Virtual.

**Features**:

- Only renders visible rows
- Smooth scrolling for million-row datasets
- Efficient DOM updates
- Integrated with diff results display

## Future Optimizations (Phase 3+)

Potential areas for further improvement:

1. **SIMD text processing** - Optimize string operations with SIMD instructions
2. **Binary format versioning** - Add version header for format evolution
3. **Progressive rendering** - Stream rendering as results arrive
4. **Web Worker pool** - Multiple workers for concurrent operations
5. **IndexedDB caching** - Cache parsed CSVs for faster re-diffs

## Monitoring Performance

### Running Benchmarks

```bash
# Run all benchmarks
cd src-wasm && cargo test --release -- --ignored --nocapture

# Run specific benchmark
cargo test --release benchmark_1m_rows_primary_key -- --ignored --nocapture

# Run benchmark summary
cargo test --release benchmark_summary -- --ignored --nocapture
```

### Performance Testing in Browser

1. Open browser DevTools
2. Go to Performance tab
3. Start recording
4. Upload and diff CSVs
5. Check for:
   - No main thread blocking (should see Worker activity)
   - Fast serialization times
   - Efficient memory usage

## Troubleshooting

### Memory Leaks

**Symptom**: Memory usage grows with each diff operation

**Solution**: Ensure `dealloc()` is called for every binary result:

```javascript
const ptr = wasm.diff_csv_binary(...);
const len = wasm.get_binary_result_length();
try {
  // ... use the data ...
} finally {
  wasm.dealloc(ptr, len); // Always clean up
}
```

### Slow Performance

**Check**:

1. Binary encoding is enabled (`USE_BINARY_ENCODING = true`)
2. WASM was built with `--release` flag
3. Browser supports SIMD and bulk memory
4. Virtual scrolling is working for large result sets

### Build Issues

**SIMD/Bulk Memory/Threads Errors**:

- Ensure `wasm-opt` has all required flags: `--enable-simd`, `--enable-bulk-memory`, `--enable-threads`
- Update `wasm-pack` to latest version
- Use Rust nightly for atomics support: `rustup run nightly wasm-pack build`
- Check browser compatibility

### SharedArrayBuffer Issues

**Symptom**: Parallel processing not working, errors about SharedArrayBuffer

**Solution**: SharedArrayBuffer requires specific HTTP headers for security:

**Development Server** (Vite):

```javascript
// vite.config.ts
export default {
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
};
```

**Production Server** (Nginx):

```nginx
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
```

**GitHub Pages / Static Hosting**:
SharedArrayBuffer may not be available on some static hosts. The app will automatically fall back to single-threaded mode.

**Check Support**:

```javascript
const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
console.log("SharedArrayBuffer support:", hasSharedArrayBuffer);
```

### Performance Dashboard Not Showing

**Symptom**: Performance dashboard not visible

**Solution**: Dashboard only appears in development mode (`import.meta.env.DEV`). In production, metrics are still collected but the UI is hidden.

To enable in production, modify `PerformanceDashboard.tsx`:

```typescript
const isDev =
  import.meta.env.DEV || localStorage.getItem("showPerfDashboard") === "true";
```

## Configuration Options

### Worker Configuration

```typescript
// src/workers/csv.worker.ts
const USE_BINARY_ENCODING = true; // Enable binary encoding (recommended)
const USE_PARALLEL_PROCESSING = true; // Enable rayon parallelization
const USE_TRANSFERABLES = true; // Enable transferable ArrayBuffers
```

### Streaming Configuration

```typescript
import { get_streaming_config } from "./src-wasm/pkg/csv_diff_wasm";

const config = get_streaming_config();
// {
//   chunkSize: 5000,
//   enableProgressUpdates: true,
//   progressUpdateInterval: 10
// }
```

## References

- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- [WebAssembly SIMD](https://github.com/WebAssembly/simd)
- [WebAssembly Threads](https://github.com/WebAssembly/threads)
- [wasm-bindgen-rayon](https://github.com/GoogleChromeLabs/wasm-bindgen-rayon)
- [SharedArrayBuffer Security](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)
- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [ahash crate](https://crates.io/crates/ahash)
