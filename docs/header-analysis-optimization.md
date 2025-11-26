# CSV Header Analysis Optimization Plan

## Problem Overview

When uploading large CSV files, the header analysis and UI refresh takes more than 5 seconds, causing the UI to hang. The current implementation parses the entire CSV file even when only headers and a few sample rows are needed for datatype analysis.

## Current State Analysis

### Issues Identified

1. **Inefficient headers-only parsing**: The `parse_csv_headers_only` function in `src-wasm/src/wasm_api.rs` calls `parse_csv_internal` which collects ALL rows into memory before returning only headers and 5 sample rows.

2. **Auto-detection bottleneck**: In `src-wasm/src/parse.rs`, the auto-detection logic uses `let rows: Vec<StringRecord> = rdr.records().collect::<Result<Vec<_>, _>>()?;` which loads the entire file into memory.

3. **No progress feedback**: Headers-only parsing doesn't provide progress callbacks, causing UI to appear frozen.

4. **UI blocking**: The main thread is blocked during header analysis, preventing user interaction.

### Current Data Flow

```
File Upload → CsvInput Component → useCsvWorker → Worker → parse_csv_headers_only → parse_csv_internal (FULL PARSE) → Headers + 5 rows
```

## Solution Architecture

### Optimized Data Flow

```
File Upload → CsvInput Component → useCsvWorker → Worker → parse_csv_headers_only (STREAMING) → Headers + 5 rows + Progress
```

## Implementation Tasks

### Task 1: Fix Headers-Only Parser Inefficiency

**File**: `src-wasm/src/wasm_api.rs`

**Current Issue**:

```rust
#[wasm_bindgen]
pub fn parse_csv_headers_only(csv_content: &str, has_headers: bool) -> Result<JsValue, JsValue> {
    let (headers, _, _) = crate::core::parse_csv_internal(csv_content, has_headers)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    // This parses the ENTIRE file into memory!
}
```

**Solution**:

- Replace `parse_csv_internal` call with a streaming approach
- Read only headers + 5 rows without collecting all records
- Use CSV iterator directly: `rdr.records().take(5).collect()`
- Add progress callback parameter

### Task 2: Optimize Auto-Detection Logic

**File**: `src-wasm/src/parse.rs`

**Current Issue**:

```rust
// Auto-detect if headers are actually data
if !headers.is_empty() && !rows.is_empty() {
    let first_row = &rows[0]; // After collecting ALL rows
    // ... analysis logic
}
```

**Solution**:

- Modify auto-detection to read only the first data row
- Use `rdr.records().next()` instead of collecting all records
- Add early exit after determining header presence
- Create `auto_detect_headers_streaming` function

### Task 3: Add Progress Reporting to Headers-Only Parsing

**File**: `src-wasm/src/wasm_api.rs`

**Implementation**:

- Add `on_progress` parameter to `parse_csv_headers_only`
- Report progress at 25%, 50%, 75%, 100% milestones
- Progress messages:
  - 25%: "Reading headers..."
  - 50%: "Detecting header format..."
  - 75%: "Reading sample rows..."
  - 100%: "Header analysis complete"

### Task 4: Fix UI Responsiveness During Upload

**File**: `src/routes/index.tsx`

**Current State**:

```typescript
const handleSourceChange = async (text: string, name: string) => {
  setSourceData({ text, name });
  // Parse to get headers for available columns
  if (text) {
    try {
      const res: any = await parse(text, name, hasHeaders, true);
      setAvailableColumns(res.headers);
      // No progress feedback shown to user
    } catch (e) {
      // Error handling
    }
  }
};
```

**Solution**:

- Add immediate "Analyzing headers..." UI feedback
- Show progress bar during header analysis under the input component
- Display headers immediately after analysis completes
- Add loading state to prevent UI interaction during analysis

### Task 5: Update Worker to Use Optimized Parsing

**File**: `src/workers/handlers/parse.ts`

**Current Implementation**:

```typescript
const result = headersOnly
  ? parse_csv_headers_only(csvText, hasHeaders !== false)
  : parse_csv_with_progress(csvText, hasHeaders !== false, postProgress);
```

**Solution**:

- Update `parse_csv_headers_only` call to include progress callback
- Ensure backward compatibility with existing parse flow
- Add error handling for malformed headers

### Task 6: Add Streaming Progress Indicators

**File**: `src/components/CsvInput.tsx`

**Implementation**:

- Add progress state to component
- Show progress bar below file input during analysis
- Display "Analyzing headers..." message
- Update UI immediately when headers are available

## Performance Optimizations

### Memory Usage Reduction

1. **Before**: `O(n)` memory where n = total rows
2. **After**: `O(1)` memory (constant, only headers + 5 rows)

### Processing Time Reduction

1. **Before**: Parse entire file (seconds for large files)
2. **After**: Read only first few rows (milliseconds)

### Progress Feedback

1. **Before**: No feedback during header analysis
2. **After**: Real-time progress at 25% intervals

## Implementation Approach

### Option B: Optimize Existing Iterator Usage (Recommended)

**Rationale**:

- Minimal code changes
- Maintains existing architecture
- Lower risk of introducing new bugs
- Faster implementation

**Steps**:

1. Modify existing `parse_csv_headers_only` function
2. Update auto-detection to use streaming approach
3. Add progress callbacks without changing core logic

### Alternative Option A: Full Streaming Rewrite

**Pros**:

- Maximum performance gains
- Cleaner architecture

**Cons**:

- Higher implementation complexity
- More risk of introducing bugs
- Longer development time

## Testing Strategy

### Unit Tests

1. Test header-only parsing with various CSV formats
2. Verify progress callback accuracy
3. Test auto-detection with edge cases

### Integration Tests

1. Test large file upload with UI responsiveness
2. Verify progress indicators display correctly
3. Test error handling for malformed CSVs

### Performance Benchmarks

1. Measure memory usage before/after optimization
2. Time header analysis for files of various sizes
3. Verify UI remains responsive during processing

## Success Metrics

1. **Performance**: Header analysis < 500ms for files up to 100MB
2. **Memory**: Constant memory usage regardless of file size
3. **UI**: No UI freezing during header analysis
4. **User Experience**: Clear progress feedback throughout process

## Rollout Plan

1. **Phase 1**: Implement core optimizations (Tasks 1-3)
2. **Phase 2**: Update UI components (Tasks 4-6)
3. **Phase 3**: Testing and validation
4. **Phase 4**: Performance benchmarking and optimization

## Risks and Mitigations

### Risk 1: Regression in CSV Parsing Accuracy

**Mitigation**:

- Comprehensive test suite
- Backward compatibility testing
- Gradual rollout with feature flags

### Risk 2: UI Complexity Increases

**Mitigation**:

- Keep progress UI simple and unobtrusive
- Reuse existing UI components
- Maintain clean separation of concerns

### Risk 3: Performance Gains Not Sufficient

**Mitigation**:

- Monitor performance metrics
- Have fallback plan for further optimizations
- Consider binary parsing if needed
