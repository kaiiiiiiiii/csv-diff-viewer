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

| Dataset Size | Time | Memory | Rows/Second |
|-------------|------|--------|-------------|
| 10k rows | 58ms | 0.52 MB | 172,000 |
| 50k rows | 269ms | 2.81 MB | 186,000 |
| 100k rows | 516ms | 5.67 MB | 194,000 |
| 500k rows | 3.3s | 30.46 MB | 151,000 |
| 1M rows | 6.4s | 61.46 MB | 156,000 |

### Diff Performance (Content Match Mode)

| Dataset Size | Time | Memory |
|-------------|------|--------|
| 10k rows | 66ms | 0.52 MB |
| 50k rows | 462ms | 2.81 MB |
| 100k rows | 908ms | 5.67 MB |
| 500k rows | 4.4s | 30.46 MB |

### Binary Encoding vs JSON

| Operation | JSON | Binary | Speedup |
|-----------|------|--------|---------|
| 1000-row serialization | 142µs | 72µs | 1.98x |
| Boundary crossing overhead | High | Low | ~2-10x |

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

## Future Optimizations (Phase 2+)

Potential areas for further improvement:

1. **Multi-threaded parallelization** - Use `wasm-bindgen-rayon` for parallel CSV diff
2. **Streaming CSV parsing** - Parse and diff in a single pass for memory efficiency
3. **Transferable ArrayBuffers** - Zero-copy data transfer between Worker and main thread
4. **Full virtual scrolling** - Complete @tanstack/react-virtual integration
5. **SIMD text processing** - Optimize string operations with SIMD
6. **Binary format versioning** - Add version header for format evolution
7. **Runtime profiling dashboard** - Visual performance monitoring UI

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

**SIMD/Bulk Memory Errors**:
- Ensure `wasm-opt` has `--enable-simd` and `--enable-bulk-memory` flags
- Update `wasm-pack` to latest version
- Check browser compatibility

## References

- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- [WebAssembly SIMD](https://github.com/WebAssembly/simd)
- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [ahash crate](https://crates.io/crates/ahash)
