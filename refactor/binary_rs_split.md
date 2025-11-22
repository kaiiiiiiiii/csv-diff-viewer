# Refactor plan for `src-wasm/src/binary.rs` — split encoder/decoder

## Goal

Split binary encoding and decoding logic into separate modules. This keeps encoding-focused performance code in its own module and makes tests clearer (roundtrip tests can be focused on decoder/encoder tests individually).

## Suggested new files

- `src-wasm/src/binary_encoder.rs`
- `src-wasm/src/binary_decoder.rs` (if a decoder exists or is needed for tests)

## Symbols to move

- `BinaryEncoder` struct and `write_*` helper functions into `binary_encoder.rs`.
- Decoder/`read` helpers into `binary_decoder.rs`.

## What to keep

- Keep a thin `binary.rs` module that imports both the encoder and decoder for integration tests (if needed), or re-export them as `pub use binary_encoder::*;`.

## Implementation steps (minimal)

1. Create `binary_encoder.rs` and move encoder logic and public `BinaryEncoder` struct there. Expose the functions used by other modules with `pub` or `pub(crate)` as needed.
2. If the repository contains decoder logic or tests that decode round-trip results, create `binary_decoder.rs` accordingly.
3. Update `mod` declarations in `lib.rs` to register the new files.
4. Add roundtrip tests for encoder/decoder to prevent regression.

## Tests to add

- `binary_encoder::roundtrip` ensures that encoding and decoding roundtrips remain consistent and unbiased.

## Risks and mitigations

- If `binary_encoder` uses complex statics or `unsafe`, keep them in the same module scope to reduce the risk of cross-module unsafety.
- Ensure test modules import the correct module path after moving files.

## Rollout plan

1. Move encoder first, keeping decoder in place to confirm tests still pass.
2. Move decoder and add roundtrip tests; run `cargo test` to validate behaviour.
