# Refactor plan for `src-wasm/src/lib.rs` — wasm_bindgen & wasm api split

## Goal

Isolate wasm-bindgen exports and shared unsafe memory handling from core logic in smaller modules. This improves maintainability, testability, and reduces the risk of exposing `unsafe` internals.

## Suggested new files

- `src-wasm/src/wasm_api.rs`
- `src-wasm/src/memory.rs`

## Symbols to move

- wasm_api.rs: all public `#[wasm_bindgen]` wrapper functions currently in `lib.rs` (e.g., `parse_csv`, `diff_csv_primary_key`, `diff_csv`, `diff_text`, `diff_csv_binary` & parallel functions, `init_thread_pool_wrapper` and `init_panic_hook` wrappers)
- memory.rs: memory allocation, `LAST_BINARY_RESULT_LENGTH/CAPACITY`, `alloc`, `dealloc`, and accompanying helper functions used by JS (if any)

## What to keep

- Keep `lib.rs` as the small module that declares `pub mod wasm_api; pub mod memory;` and re-exports as needed. Also keep the top-level `console_error_panic_hook` initialization and wasm glue re-exports if necessary.

## Implementation steps (minimal)

1. Create the new modules above and move the relevant functions out of `lib.rs`.
2. Replace existing `use` and `pub use` as required, e.g., `pub mod wasm_api; pub use wasm_api::*;`.
3. Ensure `memory.rs` maintains `unsafe` scope locally and exports safe function wrappers where JS needs them.
4. Add wasm_bindgen tests to ensure the public APIs are still reachable and behavior is consistent.
5. Build WASM via `npm run build:wasm` to confirm that JS glue generation still works and is unchanged.

## Tests to add

- `wasm_bindgen_test` to validate that exported functions call the right module functions and side-effects.
- Memory tests: e.g., `alloc`/`dealloc` safety and roundtrip interactions.

## Risks and mitigations

- The `LAST_BINARY_RESULT_*` statics should remain `pub(crate)` or `static mut` within `memory.rs` and the scope carefully guarded. Unit tests should validate that the semantics are preserved.
- Ensure that thread pool initialization and WASM-specific global state is initialized in `lib.rs` or `wasm_api.rs` as expected (do not shatter initialization logic).
- Keep `use wasm_bindgen::prelude::*` in `wasm_api.rs` and only define exports there to separate glue generation concerns.

## Rollout plan

1. Move small number of exports first, verify JS builds and tests.
2. Move memory helpers next and ensure tests for alloc/dealloc.
3. Add more exports as needed and run full integration tests.

## Additional notes

This refactor is primarily for readability and safety; keep file changes small and validate with both `cargo test` and `npm run build:wasm` after each refactor PR.
