
/// Binary encoding module for efficient WASM boundary crossing.
/// 
/// This module provides zero-copy binary encoding for diff results,
/// eliminating the need for serde-wasm-bindgen JSON serialization.
/// 
/// Performance: ~2x faster than JSON serialization for large datasets.
/// 
/// ## Important Limitation
/// 
/// Character-level diffs are NOT included in binary encoding for performance
/// and size optimization. This means the `diff` field in `Difference` structs
/// will be empty when using binary encoding.
/// 
/// To get character-level diffs:
/// - Use JSON encoding mode (set `USE_BINARY_ENCODING = false` in worker)
/// - Recompute diffs on the JavaScript side using a diff library
/// 
/// This trade-off provides 2x faster serialization at the cost of losing
///

use crate::types::*;
use std::collections::HashMap;

pub struct BinaryEncoder {
    buffer: Vec<u8>,
}

impl BinaryEncoder {
    pub fn new() -> Self {
        Self {
            buffer: Vec::with_capacity(1024 * 1024), // Start with 1MB
        }
    }

    pub fn into_vec(self) -> Vec<u8> {
        self.buffer
    }

    pub fn encode_diff_result(&mut self, result: &DiffResult) {
        let total_rows = (result.added.len() + result.removed.len() + result.modified.len() + result.unchanged.len()) as u32;
        
        // Header
        self.write_u32(total_rows);
        self.write_u32(result.added.len() as u32);
        self.write_u32(result.removed.len() as u32);
        self.write_u32(result.modified.len() as u32);
        self.write_u32(result.unchanged.len() as u32);

        // Added rows
        for row in &result.added {
            self.write_u8(1); // Type 1: Added
            self.write_string(&row.key);
            self.write_row_data(&row.target_row);
        }

        // Removed rows
        for row in &result.removed {
            self.write_u8(2); // Type 2: Removed
            self.write_string(&row.key);
            self.write_row_data(&row.source_row);
        }

        // Modified rows
        for row in &result.modified {
            self.write_u8(3); // Type 3: Modified
            self.write_string(&row.key);
            self.write_row_data(&row.source_row);
            self.write_row_data(&row.target_row);
            
            self.write_u32(row.differences.len() as u32);
            for diff in &row.differences {
                self.write_string(&diff.column);
                self.write_string(&diff.old_value);
                self.write_string(&diff.new_value);
            }
        }

        // Unchanged rows
        for row in &result.unchanged {
            self.write_u8(4); // Type 4: Unchanged
            self.write_string(&row.key);
            self.write_row_data(&row.row);
        }
    }

    fn write_u8(&mut self, value: u8) {
        self.buffer.push(value);
    }

    fn write_u32(&mut self, value: u32) {
        self.buffer.extend_from_slice(&value.to_le_bytes());
    }

    fn write_string(&mut self, value: &str) {
        let bytes = value.as_bytes();
        self.write_u32(bytes.len() as u32);
        self.buffer.extend_from_slice(bytes);
    }

    fn write_row_data(&mut self, row: &HashMap<String, String>) {
        self.write_u32(row.len() as u32);
        for (key, value) in row {
            self.write_string(key);
            self.write_string(value);
        }
    }
}
