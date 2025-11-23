# Refactor plan for `diff_utils.rs` — shared utilities module

## Goal

Move shared utilities into a single module (`diff_utils.rs`) so `primary_key.rs`, `content_match.rs`, `parse.rs`, and future modules can import them without circular dependencies. This will keep code DRY and make functions easy to test and optimize.

## Symbols to move

- `normalize_value_with_empty_vs_null`
- `is_empty_or_null`
- `record_to_hashmap`
- `get_row_fingerprint`
- `get_row_key`
- `calculate_row_similarity`
- `similarity_jaro_winkler` and `similarity_levenshtein` (optional — keep if used by other modules)

## Why

- Avoid duplicate logic across parsing and diffing
- Prevent circular imports (shared helpers always in one place)
- Easier to benchmark and optimize (fingerprinting + similarity)
- Encourages `pub(crate)` visibility for internal functions, keeping the public API stable

## Implementation steps (minimal)

1. Create `src-wasm/src/diff_utils.rs` and move above helper functions from `utils.rs` into it.
2. Keep `utils.rs` but remove the moved helpers (or keep thin wrappers if necessary). Keep `utils.rs` for JS-facing helpers and other non-shared code.
3. Update all imports that currently `use crate::utils::*;` to `use crate::diff_utils::*;` or `use crate::utils::*; use crate::diff_utils::*;` where appropriate.
4. Mark internal-only helpers as `pub(crate)` to avoid exposing them in the WASM API accidentally.
5. Update any references in `lib.rs` or module files that import helpers directly (e.g., `core::` referencing functions now in `diff_utils.rs` — reference via `crate::diff_utils::...` or `use crate::diff_utils::*;`).
6. Add unit tests for each helper in `diff_utils.rs` (fingerprinting, normalize, row_key, similarity), based on `test_data.rs` expected values.

## Tests to add

- Fingerprinting tests (case-insensitive vs case-sensitive behavior, excluded columns, empty/null normalization)
- Row key tests (composite keys, missing columns, headerless CSV rows)
- Similarity tests (Jaro-Winkler vs Levenshtein for short/long text, expected thresholds)

## Risks and mitigations

- Performance: ensure `get_row_fingerprint` avoids unnecessary allocations (pass by reference, use `String::with_capacity` or `concat` patterns). Add benchmarks for critical functions
- Compiler errors: update all uses to import from new module. Run `cargo test` and `npm run build:wasm` to catch errors.

## Rollout plan

1. Move a small set of functions first: `normalize_value_with_empty_vs_null`, `get_row_key`, `record_to_hashmap`.
2. Update imports, re-run tests.
3. Move heavier helpers (fingerprinting & similarity), run full test suite.
4. Run `npm run build:wasm` and `npm run build` for full project verification.

---

_Notes:_ Keep all functions `pub(crate)` unless they must be exported to JS via `lib.rs` and WASM bindings.

## Additional notes

This refactor is primarily for readability and safety; keep file changes small and validate with both `cargo test` and `npm run build:wasm` after each refactor PR.
