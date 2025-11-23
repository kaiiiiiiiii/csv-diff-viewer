use wasm_bindgen::prelude::*;

/// WASM memory allocation helpers and last binary result metadata

/// Storage for the last binary result length.
/// # Safety
/// These statics are mutated from other modules; ensure proper synchronization if used by multiple threads.
static mut LAST_BINARY_RESULT_LENGTH: usize = 0;
static mut LAST_BINARY_RESULT_CAPACITY: usize = 0;

#[wasm_bindgen]
pub fn alloc(size: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[wasm_bindgen]
pub fn dealloc(ptr: *mut u8, size: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr, 0, size);
    }
}

pub(crate) fn set_last_binary_result_length(len: usize) {
    unsafe {
        LAST_BINARY_RESULT_LENGTH = len;
    }
}

pub(crate) fn set_last_binary_result_capacity(cap: usize) {
    unsafe {
        LAST_BINARY_RESULT_CAPACITY = cap;
    }
}

#[wasm_bindgen]
pub fn get_binary_result_length() -> usize {
    unsafe { LAST_BINARY_RESULT_LENGTH }
}

#[wasm_bindgen]
pub fn get_binary_result_capacity() -> usize {
    unsafe { LAST_BINARY_RESULT_CAPACITY }
}
