#!/bin/bash
set -e

export CARGO_BUILD_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--import-memory -C link-arg=--shared-memory -C link-arg=--max-memory=1073741824'
export CARGO_UNSTABLE_BUILD_STD='std,panic_abort'

wasm-pack build --target web "$@"
