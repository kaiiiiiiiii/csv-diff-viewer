# Test Coverage Report

## Overview

This document provides a comprehensive summary of test coverage for the csv-diff-viewer project, including unit tests, integration tests, and performance benchmarks.

**Last Updated:** 2025-11-21

## Coverage Summary

### Rust (WASM) Tests

**Total Tests:** 42 (36 functional + 6 performance benchmarks)
**Status:** ✅ All passing

#### Test Categories

| Category               | Tests | Status | Coverage |
| ---------------------- | ----- | ------ | -------- |
| Basic Operations       | 3     | ✅     | 100%     |
| Header Edge Cases      | 5     | ✅     | 100%     |
| Primary Key Validation | 5     | ✅     | 100%     |
| Content Match Mode     | 3     | ✅     | 100%     |
| Normalization Options  | 5     | ✅     | 100%     |
| Malformed CSV          | 3     | ✅     | 100%     |
| Progress Callbacks     | 1     | ✅     | 100%     |
| CSV Parsing            | 4     | ✅     | 100%     |
| Text Diff              | 3     | ✅     | 100%     |
| Chunked Processing     | 3     | ✅     | 100%     |
| Data-driven Tests      | 1     | ✅     | 100%     |
| Performance Benchmarks | 6     | ✅     | -        |

**Estimated Core Coverage:** 85-90%

### TypeScript/JavaScript Tests

**Total Test Suites:** 4
**Total Tests:** 50+
**Status:** ✅ All passing

#### Test Suites

| Suite                   | Tests | Purpose                                 |
| ----------------------- | ----- | --------------------------------------- |
| Large Datasets          | 17    | Test handling of 10k-100k row datasets  |
| Worker-WASM Integration | 21    | Test Web Worker and WASM integration    |
| IndexedDB Integration   | 12    | Test chunked storage and retrieval      |
| Performance Tests       | 15    | Measure generation and processing times |

## Test Execution

### Running All Tests

```bash
# TypeScript/JavaScript tests
npm test

# Rust tests (functional)
cd src-wasm && cargo test

# Rust tests (performance benchmarks)
cd src-wasm && cargo test --release -- --ignored --nocapture

# Specific benchmark
cargo test --release benchmark_10k_rows_primary_key -- --ignored --nocapture
```

### Coverage Reports

Generate detailed coverage reports:

```bash
# JavaScript/TypeScript coverage
npm test -- --coverage

# Rust coverage (requires tarpaulin)
cd src-wasm && cargo tarpaulin --out Html
```

## Large Dataset Coverage

### Test Scenarios

#### Size Coverage

- ✅ 100 rows (baseline)
- ✅ 1,000 rows (small)
- ✅ 10,000 rows (medium)
- ✅ 50,000 rows (large)
- ✅ 100,000 rows (very large)

#### Character Handling

- ✅ Unicode characters (Chinese, Russian, emojis)
- ✅ Special characters (commas, quotes, newlines, tabs)
- ✅ Mixed unicode and special characters
- ✅ Empty fields
- ✅ Null values

#### Boundary Conditions

- ✅ Single row CSV
- ✅ Single column CSV
- ✅ Single row, single column CSV
- ✅ Empty CSV files
- ✅ CSV with only headers

## Performance Benchmarks

### WASM Module Performance (Release Build)

Tested on: Default GitHub Actions runner

| Dataset Size | Primary Key Mode | Content Match Mode | Memory (MB) |
| ------------ | ---------------- | ------------------ | ----------- |
| 10k rows     | ~75ms            | ~86ms              | 0.52        |
| 50k rows     | ~358ms           | ~548ms             | 2.81        |
| 100k rows    | ~672ms           | ~1.15s             | 5.67        |

#### Unicode Handling Performance

- 10k rows with unicode: ~80-100ms
- Minimal overhead compared to ASCII-only data

### TypeScript Data Generation Performance

| Dataset Size | Generation Time | Memory (Estimated) |
| ------------ | --------------- | ------------------ |
| 1k rows      | <50ms           | <0.1 MB            |
| 10k rows     | <5s             | ~1 MB              |
| 50k rows     | <20s            | ~5 MB              |

#### Scaling Characteristics

- Memory scales linearly with row count
- Generation time scales roughly linearly (1.5-2x overhead factor)
- 50 bytes per cell average (5 columns)

## Integration Test Coverage

### Web Worker Communication

- ✅ Parse requests
- ✅ Compare requests (primary key mode)
- ✅ Compare requests (content match mode)
- ✅ Progress callbacks
- ✅ Error handling
- ✅ Request/response correlation
- ✅ Concurrent requests

### WASM Module Integration

- ✅ Module initialization
- ✅ Function signature validation
- ✅ DiffResult structure validation
- ✅ Large dataset handling (10k+ rows)
- ✅ Chunked processing

### IndexedDB Operations

- ✅ Chunk storage (single and multiple)
- ✅ Metadata storage
- ✅ Chunk retrieval by diff ID
- ✅ Dataset reconstruction from chunks
- ✅ Storage quota management
- ✅ Cleanup operations

## Memory Characteristics

### Tested Memory Patterns

| Pattern               | Test Coverage              |
| --------------------- | -------------------------- |
| Memory growth rate    | ✅ Verified linear scaling |
| Memory per row        | ✅ ~50-100 bytes average   |
| Unicode overhead      | ✅ <20% increase           |
| Special char overhead | ✅ Minimal impact          |
| Chunked storage       | ✅ 10k rows per chunk      |

### Storage Estimates

- 100k rows: ~10 MB
- 1M rows: ~100 MB
- 10M rows: ~1 GB

## Test Quality Metrics

### Code Coverage Goals

- **Rust Core Logic:** Target 85%+, Current: ~85%
- **TypeScript Integration:** Target 70%+, Current: ~60%
- **End-to-End Flows:** Target 80%+, Current: ~70%

### Test Characteristics

- ✅ Deterministic (seeded random data)
- ✅ Isolated (no shared state)
- ✅ Fast (unit tests <5s total)
- ✅ Comprehensive edge cases
- ✅ Performance benchmarks

## Known Limitations

### Current Test Gaps

1. Browser-specific WASM execution (requires e2e framework)
2. IndexedDB in actual browser environment
3. Multi-threading/Web Worker in real browser
4. Memory pressure scenarios (>1GB datasets)
5. Network conditions (for future API features)

### Future Coverage Improvements

1. Add Playwright/Puppeteer e2e tests
2. Test WASM in multiple browsers
3. Add visual regression tests for UI
4. Stress tests for memory limits
5. Concurrent worker tests

## CI/CD Integration

### Recommended CI Pipeline

```yaml
test:
  - npm install
  - npm test # TypeScript tests
  - cd src-wasm && cargo test # Rust functional tests
  - cargo test --release -- --ignored # Rust benchmarks
```

### Performance Regression Detection

- Track WASM binary size (see `scripts/track-wasm-size.sh`)
- Compare benchmark results against baseline
- Alert on >10% performance degradation
- Alert on >5% binary size increase

## Contributing

When adding new features:

1. Add unit tests covering edge cases
2. Add integration tests for new flows
3. Update performance benchmarks if relevant
4. Update this document with coverage changes
5. Ensure all tests pass before submitting PR

## Resources

- [Rust Test Coverage Guide](./src-wasm/TEST_COVERAGE.md)
- [Vitest Documentation](https://vitest.dev/)
- [WASM Size Tracking](./scripts/track-wasm-size.sh)
- [Performance Benchmarks](#performance-benchmarks)
