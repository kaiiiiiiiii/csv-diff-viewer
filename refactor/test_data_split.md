# Refactor plan for `src-wasm/src/test_data.rs` — split into smaller test files

## Goal

Split the large test data file into multiple files grouped by related scenarios to reduce file size, improve discoverability, and allow more focused test runs.

## Suggested new files

- `src-wasm/src/testdata/basic_with_headers.rs`
- `src-wasm/src/testdata/header_edge_cases.rs`
- `src-wasm/src/testdata/primary_key_validation.rs`
- `src-wasm/src/testdata/content_match.rs`
- `src-wasm/src/testdata/malformed_csv.rs`

## Symbols to move

- Move constants and fixtures grouped in `test_data.rs` into corresponding new files. For example, `SIMPLE_DIFF`, `ADD_REMOVE` go into `basic_with_headers.rs`.

## What to keep

- Keep a top-level `src-wasm/src/testdata/mod.rs` that aggregates these modules and provides `pub use` exports used by tests.

## Implementation steps

1. Create `src-wasm/src/testdata` directory.
2. Organize the `mod` matches / constants into each file, ensuring names are unique and constant definitions are `pub(crate)` where needed.
3. Replace existing `mod` references in tests to import from `testdata::...` or `crate::testdata::...`.
4. Update `Cargo.toml` test targets or `#[cfg(test)]` references to acknowledge the new path if required.

## Tests to add

- Each new file should include `#[cfg(test)]` unit tests as appropriate for the fixtures moved. Where a previous integration test relied on multiple fixtures, create an aggregated test that imports them.

## Risks and mitigations

- Tests that reference paths in `test_data.rs` will need imports updated. Use `mod` aggregator file to keep the import surface consistent.
- Keep naming consistent with the rest of the test modules to avoid confusion.

## Rollout plan

1. Move `basic_with_headers` first and update tests.
2. Run `cargo test` and fix failures related to path changes.
3. Continue moving other groups and re-run tests.
