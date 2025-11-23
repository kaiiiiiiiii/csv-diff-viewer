mod types;
mod utils;
mod parse;
mod primary_key;
mod content_match;
pub mod core;
mod binary;
mod binary_encoder;
mod profiling;
pub mod parallel;
mod streaming;
mod memory;
mod wasm_api;
mod wasm_tests;

pub use wasm_api::*;
pub use memory::*;

#[cfg(test)]
mod test_data;

pub use wasm_bindgen_rayon::init_thread_pool;



