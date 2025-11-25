# WASM Debugging Guide for CSV Diff Viewer

## TL;DR

```
npm run build:wasm:dev
npm run dev
```

Open Chrome DevTools → Sources → wasm → Set breakpoints in Rust code!

## 1. Build Development WASM (with Debug Symbols & Source Maps)

The project now has two WASM profiles:

- **Release** (`npm run build:wasm`): Optimized, stripped symbols (production)
- **Dev** (`npm run build:wasm:dev`): Debug symbols, source maps, slower (development/debugging)

```
npm run build:wasm:dev
npm run dev  # or npm run dev:wasm (builds dev WASM + starts dev server)
```

**Cargo.toml** already configured with `[profile.dev]` and wasm-pack metadata for optimal dev builds.

## 2. Runtime Debugging: Browser DevTools (Primary Method for Rust WASM)

Modern browsers (Chrome 91+, Firefox 89+) natively support Rust source-level debugging via DWARF debug info + source maps.

### Steps:

1. Build dev WASM: `npm run build:wasm:dev`
2. Start dev server: `npm run dev`
3. Open [http://localhost:3000](http://localhost:3000) in **Chrome** or **Firefox**
4. Open DevTools: **F12** → **Sources** tab
5. Navigate to:
   - **Page** → **top** → **wasm** → `csv_diff_wasm_bg.wasm`
   - Or search for "wasm" in Sources panel
6. **Browser auto-loads Rust sources** (`lib.rs`, `core.rs`, etc.) with line numbers!
7. **Set breakpoints** directly in Rust code
8. Trigger a CSV diff operation in the app → **Breakpoints hit in Rust!**
9. Inspect locals, step over/next, etc.

### Pro Tips:

- Use **blackboxing** JS files to focus on Rust/WASM stack frames
- **Call stack** shows Rust functions when paused
- Console logging via `web-sys::console::log_()` works great
- Panic hook (`init_panic_hook()`) logs Rust panics to console

## 3. VSCode Integration

### Static Analysis (Rust-Analyzer)

1. Install **rust-analyzer** VSCode extension
2. Open `src-wasm/` folder (or whole workspace)
3. **Full Rust LSP support**: Hover, go-to-def, errors, etc. for `wasm32-unknown-unknown`
4. `rust-toolchain.toml` pins nightly with `rust-src` for accurate analysis

### JS + WASM Callstack Debugging

`.vscode/launch.json` added:

```
"Debug CSV Diff Viewer (Chrome)"
```

- Launches Chrome debugger-attached
- Set **JS breakpoints** in `src/workers/`
- **WASM frames visible** in callstack (with Rust symbols if dev build)

**Attach mode**:

1. Chrome: `chrome --remote-debugging-port=9222 http://localhost:3000`
2. VSCode: "Attach to Chrome DevTools (WASM)"

## 4. Testing

```
cd src-wasm
cargo test          # Native Rust tests
cargo test --target wasm32-unknown-unknown  # WASM tests
```

## 5. Troubleshooting

| Issue                       | Solution                                                |
| --------------------------- | ------------------------------------------------------- |
| No Rust sources in DevTools | Rebuild `npm run build:wasm:dev`; refresh page          |
| "Source map not found"      | Ensure `--dev` flag; check console for wasm-pack errors |
| Slow dev build              | Normal; use release for perf testing                    |
| Threads fail                | Check COOP/COEP headers (already in `vite.config.ts`)   |
| Memory errors               | Increase initial heap in Cargo.toml `[profile.dev]`     |

## 6. Workflow

```
# Debug cycle
npm run build:wasm:dev
npm run dev
# Edit Rust → Ctrl+C → rebuild → refresh browser
```

**Production**: `npm run build` (auto-uses release WASM)

This setup enables **full source-level debugging** of Rust WASM code directly in browser DevTools – the gold standard for WASM debugging!
