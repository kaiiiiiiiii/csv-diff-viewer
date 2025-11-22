# Refactor plan for `src-wasm/src/core.rs` — split into parse, primary key, content match

## Goal

Split `core.rs` which contains CSV parsing, fingerprinting, primary-key diff logic, and content-match/fuzzy matching into smaller modules to improve readability, testability, and enable targeted performance improvements.

## Suggested new files

- `src-wasm/src/parse.rs` — parsing & header generation utilities
- `src-wasm/src/primary_key.rs` — primary-key diff functions and helper routines
- `src-wasm/src/content_match.rs` — content-match / fuzzy matching logic and similarity functions
- `src-wasm/src/diff_utils.rs` — shared utilities such as `normalize_value`, `get_row_fingerprint`, `build_map`, `row_similarity`

## Symbols to move

- parse.rs: `parse_csv_internal` and parsing helpers (auto-header detection, record-to-row mapping)
- primary_key.rs: `diff_csv_primary_key_internal`, map builders and deduplication logic
- content_match.rs: `diff_csv_internal`, fuzzy matching, Jaro-Winkler or other similarity heuristics
- diff_utils.rs: shared `normalize_value`, hashing/fingerprint functions, column comparators, similarity scoring helpers

## What to keep

- Keep `core.rs` lightweight, more like an orchestrator that re-exports or calls into these new modules if necessary, or convert `core.rs` into an integration module that picks the right diffing strategy.

## Implementation steps (minimal)

1. Create new modules and add modules to `lib.rs`: `pub mod parse; pub mod primary_key; pub mod content_match; pub mod diff_utils;`.
2. Move parsing code into `parse.rs` with proper `pub`/`pub(crate)` annotations. Replace internal reliance with `use crate::parse::*` where needed.
3. Move primary-key and content match code into respective modules; ensure all helpers are imported from `diff_utils`.
4. Modify code to use `pub use` to retain existing public functions if necessary.
5. Update any `use` path in code that references old module-private functions.
6. Add unit tests for `parse.rs`, `primary_key.rs`, and `content_match.rs` based on existing tests/examples in `test_data.rs` or `tests`.

## Tests to add

- Parsing tests (header detection, empty headers, headerless CSV)
- Primary-key tests (duplicate detection, join logic, unique key edge cases)
- Content-match tests (fuzzy matching correctness and expected thresholds)

## Risks and mitigations

- Potential circular references: put shared helpers into `diff_utils.rs` so both primary and content match modules can import helpers rather than each other.
- Performance impact: verify that heavy data structures are passed by reference or with `pub(crate)` to avoid unnecessary cloning.
- Keep public API stable by `pub use` or re-exporting required functions from a small `core.rs` entrypoint.

## Rollout plan

1. Move small pieces first: `diff_utils.rs` + `parse.rs` and update core tests.
2. Move primary-key or content-match next and test performance using local benchmarks if available.
3. Re-balance utilities and re-run `cargo test` and wasm builds. Add additional tests as needed.
