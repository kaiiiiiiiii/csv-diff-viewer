# Refactor plan for module-level tests

## Goal

Add targeted unit tests to the new modules (`parse.rs`, `primary_key.rs`, `content_match.rs`) to improve test granularity and ensure refactor correctness.

## Suggested tests

- parse.rs
  - Header-detection tests (numeric header vs data row) — port existing tests in `lib.rs` or `test_data.rs`.
  - Headerless CSV parsing and auto-generated headers.
  - Trimming and whitespace handling behavior.

- primary_key.rs
  - Duplicate primary key detection for source and target.
  - Added/Removed/Modified detection with a small dataset.
  - Excluded columns handling.

- content_match.rs
  - Exact fingerprint matching test.
  - Fuzzy similarity behavior (for candidate selection and threshold).
  - Excluded column behavior and header alignment when headers differ but same count.

## Implementation steps

1. Create test modules inside each new module file using `#[cfg(test)] mod tests` and add small unit tests that exercise internal helper functions and module functions directly.
2. If you prefer, add tests in `src-wasm/src/tests` separate test files that call `core::...` functions and assert expected `DiffResult`s.
3. Keep integration-style tests in `lib.rs` (calls into WASM and uses wasm-bindgen test harness if necessary).
4. Re-run `cargo test` and `npm run build:wasm` to ensure the tests and build pass with the new module structure.

## Notes

- Try to keep tests small and deterministic (avoid randomization) to keep the CI stable.
- For heavy dataset tests, use `#[ignore]` benchmarks or dedicated `bench` tests to avoid slowing test suites.

---

_Tip:_ Start by porting the current tests that already reference `core::` functions into targeted module tests; this helps ensure parity while improving test coverage.
