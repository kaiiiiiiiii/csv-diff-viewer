# Rayon & Shared Memory Integration Plan

## Overview

This document maps the research on `wasm-bindgen-rayon` and shared memory to our CSV diff viewer project. The goal is to fix the "mismatch in shared state of memory" error and enable reliable parallel diffing using Rayon in WASM.

## Root Cause Analysis

The error occurs when:

1. WASM binary is compiled with `--import-memory` expecting shared memory
2. JavaScript creates non-shared `WebAssembly.Memory` or doesn't provide one
3. Result: LinkError about shared state mismatch

## Current Project State

### ✅ Already Implemented

- **Build flags**: `RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--import-memory'` in `package.json` scripts
- **Cargo.toml**: `wasm-bindgen-rayon` dependency with `parallel` feature enabled
- **Vite config**: COOP/COEP headers for cross-origin isolation
- **WASM context**: `src/workers/wasm-context.ts` creates shared memory and handles fallbacks
- **GitHub Pages**: COI service worker (`public/coi-serviceworker.js`) and thread enabler (`public/enable-threads.js`) solve cross-origin isolation issues

### 🔄 Build Process

- `npm run build` → `npm run build:wasm` → `vite build` (enforces WASM rebuild)
- WASM built with `--target web --release` and required flags

## Required Changes

### 1. Rust Build Configuration (Already Done)

**File**: `src-wasm/Cargo.toml`

```toml
[features]
default = ["parallel"]
parallel = ["rayon", "wasm-bindgen-rayon"]

[package.metadata.wasm-pack.profile.release]
wasm-opt = ["-O4", "--enable-simd", "--enable-bulk-memory", "--enable-threads"]
rustflags = ["-C", "target-feature=+atomics,+bulk-memory,+mutable-globals,+sign-ext"]
```

**Build command** (already in `package.json`):

```bash
RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--import-memory' \
wasm-pack build --target web --release
```

### 2. JavaScript Shared Memory Creation (Already Done)

**File**: `src/workers/wasm-context.ts`

```typescript
// Creates shared memory when available
if (sharedArrayBufferSupported && USE_PARALLEL_PROCESSING) {
  memory = new WebAssembly.Memory({
    initial: 20,
    maximum: 16384,
    shared: true,
  });

  // Passes to WASM init
  glue.initSync({ module: wasmBytes, memory });
}
```

### 3. Worker Thread Support (Already Done)

**File**: `src/workers/csv.worker.ts`

```typescript
// Already calls initWasm() which handles thread pool
if (!wasmInitialized) {
  await initWasm(); // This initializes thread pool if possible
  wasmInitialized = true;
}
```

### 4. Vite Configuration (Already Done)

**File**: `vite.config.ts`

```typescript
// Cross-origin isolation headers
server: {
  headers: {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
  },
},
preview: {
  headers: {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  },
},
```

## Developer Diagnostics

### Quick Debug Checklist

1. **Check browser support**:

   ```javascript
   console.log("SharedArrayBuffer:", typeof SharedArrayBuffer !== "undefined");
   console.log("Cross-origin isolated:", crossOriginIsolated);
   ```

2. **Check WASM memory**:

   ```javascript
   import { getWasmMemory } from "./wasm-context";
   const mem = getWasmMemory();
   console.log("Is shared:", mem.buffer instanceof SharedArrayBuffer);
   ```

3. **Check thread pool**:
   ```javascript
   console.log("Hardware concurrency:", navigator.hardwareConcurrency);
   ```

### Fallback Behavior

- If `SharedArrayBuffer` unavailable → Single-threaded mode
- If cross-origin isolation missing → Single-threaded mode
- If WASM rejects shared memory → Single-threaded mode
- All fallbacks logged with clear messages

## Testing

### CI Validation

Add to GitHub Actions workflow:

```yaml
- name: Test WASM shared memory
  run: |
    cd src-wasm
    cargo test --features parallel
    # Verify thread pool export exists
    grep -q "init_thread_pool" pkg/csv_diff_wasm.js
```

### Manual Testing

```bash
# Build with shared memory
npm run build:wasm

# Check WASM exports
grep "init_thread_pool\|initThreadPool" src-wasm/pkg/csv_diff_wasm.js

# Test in browser console
console.log('Shared memory ready:', typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated);
```

## Deployment Notes

### GitHub Pages

- COI service worker handles cross-origin isolation
- Thread enabler script provides fallback for older browsers
- No additional server configuration needed

### Other Hosting

For Netlify/Cloudflare/Vercel, add headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Performance Impact

### Memory Usage

- Shared memory: 20 pages initial (1.28MB) → 16384 max (1GB)
- Per-thread overhead: ~2MB additional memory
- Total: ~50-100MB for typical datasets

### Thread Scaling

- Uses `navigator.hardwareConcurrency` (usually 4-16 cores)
- Rayon automatically partitions work across threads
- Best for: Large datasets (>100k rows), complex comparisons

## Troubleshooting

### Common Issues

1. **"mismatch in shared state of memory"**
   - **Cause**: WASM built without `--import-memory`
   - **Fix**: Rebuild with `npm run build:wasm`

2. **Thread pool not initializing**
   - **Cause**: Missing cross-origin isolation
   - **Fix**: Check COI service worker loaded

3. **SharedArrayBuffer undefined**
   - **Cause**: Browser doesn't support or COOP/COEP missing
   - **Fix**: Use single-threaded fallback (automatic)

### Debug Commands

```bash
# Rebuild WASM with verbose output
cd src-wasm && RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--import-memory -C link-arg=--shared-memory' wasm-pack build --target web --release --verbose

# Check WASM binary for shared memory imports
wasm-objdump -x src-wasm/pkg/csv_diff_wasm_bg.wasm | grep -i shared
```

## Migration Path

### Phase 1: Validation (Current)

- ✅ Build flags configured
- ✅ JS shared memory creation
- ✅ Fallback handling
- ✅ GitHub Pages compatibility

### Phase 2: Optimization (Future)

- Add performance benchmarks for threaded vs single-threaded
- Implement adaptive thread pool sizing
- Add memory usage monitoring

### Phase 3: Advanced Features (Future)

- Streaming parallel processing
- GPU acceleration via WebGPU
- Distributed processing across multiple workers
