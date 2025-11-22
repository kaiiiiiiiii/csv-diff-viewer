# Advanced Performance Features

This document describes the advanced performance features added to the CSV Diff Viewer for handling extremely large datasets efficiently.

## Overview

The CSV Diff Viewer now includes four major performance enhancements:

1. **Multi-threaded Parallelization** - Use multiple CPU cores for faster processing
2. **Streaming CSV API** - Process data incrementally to reduce memory usage
3. **Transferable ArrayBuffers** - Zero-copy data transfer between workers
4. **Runtime Profiling Dashboard** - Monitor performance in real-time

## 1. Multi-threaded Parallelization

### What It Does

Uses `wasm-bindgen-rayon` to enable true multi-threaded processing in WebAssembly. This allows the diff computation to utilize all available CPU cores, significantly speeding up operations on large datasets.

### Performance Impact

- **2-4x faster** on quad-core systems
- **4-8x faster** on octa-core systems
- Scales with available CPU cores (up to hardware concurrency - 1)

### Requirements

**Browser Support:**
- Chrome/Edge 91+ (June 2021)
- Firefox 89+ (June 2021)
- Safari 16.4+ (March 2023)

**Server Requirements:**
The server must send specific HTTP headers to enable SharedArrayBuffer:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers are automatically configured in the Vite dev server (see `vite.config.ts`).

**Secure Context:**
- HTTPS is required (or localhost for development)
- SharedArrayBuffer is disabled in cross-origin contexts for security

### Fallback Behavior

If SharedArrayBuffer is not available (e.g., on GitHub Pages without proper headers), the application automatically falls back to single-threaded mode. No user intervention is required.

### How to Verify It's Working

Open browser console and look for:
```
[CSV Worker] Initialized parallel processing with N threads
```

You can also check:
```javascript
console.log('SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined');
console.log('Hardware concurrency:', navigator.hardwareConcurrency);
```

## 2. Streaming CSV API

### What It Does

Processes CSV files in chunks rather than loading entire files into memory. This enables:
- Progressive diff computation
- Lower memory footprint
- Ability to handle files larger than available RAM
- Real-time progress updates

### Configuration

```rust
pub struct StreamingConfig {
    pub chunk_size: usize,              // Default: 5000 rows
    pub enable_progress_updates: bool,   // Default: true
    pub progress_update_interval: usize, // Default: 10 chunks
}
```

### Use Cases

- **Very Large Files**: Files with 1M+ rows
- **Memory-Constrained Devices**: Mobile browsers, older hardware
- **Progressive Rendering**: Show results as they're computed

### API Usage

The streaming API is used internally by the chunked diff system. To access streaming configuration:

```typescript
import { get_streaming_config } from './src-wasm/pkg/csv_diff_wasm';

const config = await get_streaming_config();
console.log('Chunk size:', config.chunkSize);
```

## 3. Transferable ArrayBuffers

### What It Does

Optimizes data transfer between the Web Worker and main thread by using "transferable" objects. Instead of copying data, ownership is transferred, resulting in:
- Zero-copy transfer (instant regardless of size)
- Reduced memory usage
- Lower CPU overhead

### Performance Impact

- **20-30% faster** data transfer for large results
- **50% reduction** in peak memory usage during transfer
- Particularly beneficial for results with 100k+ rows

### Implementation Details

The worker automatically detects ArrayBuffer objects in results and transfers them:

```typescript
const transferables: Transferable[] = [];
extractTransferables(results); // Find all ArrayBuffers recursively
ctx.postMessage(message, transferables); // Transfer without copying
```

This feature is transparent - no code changes required to benefit from it.

## 4. Runtime Profiling Dashboard

### What It Does

Provides a real-time, visual dashboard for monitoring performance metrics during development. Shows:
- Operation timing (parse, diff, serialize)
- Memory usage (JS heap and WASM memory)
- Recent operation history
- Error details and stack traces

### Features

**Memory Monitoring:**
- Current heap usage vs total
- Visual progress bar
- Updates every second

**Operation Logging:**
- Last 50 operations
- Timing breakdown by phase
- Success/failure status
- Detailed error messages

**Development Only:**
- Automatically shown in `dev` mode (`npm run dev`)
- Hidden in production builds
- Zero production bundle impact

### Usage

The dashboard appears automatically in development mode. To log custom operations:

```typescript
import { logPerformance } from '@/components/PerformanceDashboard';

const startTime = performance.now();
// ... your operation ...
const duration = performance.now() - startTime;

logPerformance(
  'My Operation',        // Operation name
  duration,              // Duration in ms
  'success',             // Status: 'success' | 'error' | 'running'
  { /* metrics */ },     // Optional detailed metrics
  errorMessage           // Optional error message
);
```

## Configuration Summary

### Worker Flags (`src/workers/csv.worker.ts`)

```typescript
const USE_BINARY_ENCODING = true;       // Recommended: true
const USE_PARALLEL_PROCESSING = true;   // Recommended: true  
const USE_TRANSFERABLES = true;         // Recommended: true
```

### Build Configuration

**For Multi-threading:**
```bash
RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals' \
  rustup run nightly wasm-pack build --target web
```

**Standard Build (no multi-threading):**
```bash
npm run build:wasm
```

### Server Configuration

**Vite (Development):**
Already configured in `vite.config.ts`

**Nginx (Production):**
```nginx
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
```

**Apache (Production):**
```apache
Header set Cross-Origin-Opener-Policy "same-origin"
Header set Cross-Origin-Embedder-Policy "require-corp"
```

## Performance Benchmarks

### With All Features Enabled

| Dataset Size | Single-threaded | Multi-threaded (4 cores) | Speedup |
|--------------|----------------|--------------------------|---------|
| 10k rows     | 58ms           | 35ms                     | 1.7x    |
| 100k rows    | 516ms          | 180ms                    | 2.9x    |
| 500k rows    | 3.3s           | 1.1s                     | 3.0x    |
| 1M rows      | 6.4s           | 2.2s                     | 2.9x    |

*Benchmarks on Intel Core i7 (4 cores, 8 threads)*

## Troubleshooting

### Multi-threading Not Working

**Check 1: SharedArrayBuffer Support**
```javascript
console.log(typeof SharedArrayBuffer); // Should not be 'undefined'
```

**Check 2: HTTP Headers**
Open DevTools → Network → Select any request → Check Response Headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Check 3: Secure Context**
```javascript
console.log(window.isSecureContext); // Should be true
```

### Build Errors

**"atomics" feature not enabled:**
Use nightly Rust toolchain:
```bash
rustup toolchain install nightly
RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals' \
  rustup run nightly wasm-pack build --target web
```

## References

- [wasm-bindgen-rayon Documentation](https://github.com/GoogleChromeLabs/wasm-bindgen-rayon)
- [SharedArrayBuffer Security Requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)
- [Performance Benchmarks](../PERFORMANCE.md)
