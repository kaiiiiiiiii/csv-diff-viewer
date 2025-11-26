# Refactor plan for module visibility & exports

## Goal

Make the new modules (`parse.rs`, `primary_key.rs`, `content_match.rs`) crate-level (optionally public) modules and ensure the existing `core` module re-exports the APIs we want stable for the WASM interface. This ensures we keep the public API the same while making the implementation modular.

## What to change

- In `lib.rs` add `pub mod parse; pub mod primary_key; pub mod content_match;` if you want these modules visible to other crates. Otherwise `mod parse; mod primary_key; mod content_match;` is fine for internal usage.
- Keep `core` as the high-level entry point with `pub use crate::parse::parse_csv_internal;` etc. to retain existing usage for the rest of the codebase.
- Keep the WASM API surface unchanged (`parse_csv`, `diff_csv`, `diff_csv_primary_key`, `CsvDiffer`) which call into `core::...` functions for stability.

## Implementation steps (minimal)

1. Decide which modules are public API (`pub mod`) vs crate-private (`mod`). We recommend keeping `parse`, `primary_key`, and `content_match` `mod` unless external crates need them.
2. Add `mod parse; mod primary_key; mod content_match;` (or `pub mod` if deliberate) to `lib.rs` (we already added these).
3. Update `core.rs` to `pub use` the functions from the submodules as `core`-facing functions (already done).
4. Ensure the `lib.rs`' `wasm` functions call `core::...` as before — no changes required to the JS API.

## Tests to add

- Tests ensuring that the `core::parse_csv_internal` etc. still behave the same as before.
- Unit tests in the submodules that exercise the module-level functions directly (optional).

---

_Notes:_ The public vs crate-private decision depends on whether downstream consumers (tests, extensions) should access the modules directly. Keeping them private reduces the surface area and prevents accidental API use.

## Additional notes

This refactor is primarily for readability and safety; keep file changes small and validate with both `cargo test` and `npm run build:wasm` after each refactor PR.
