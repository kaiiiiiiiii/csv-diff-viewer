# Testing Guide

This document provides comprehensive guidance on testing the CSV Diff Viewer project.

## Table of Contents
- [Quick Start](#quick-start)
- [Test Suites](#test-suites)
- [Running Tests](#running-tests)
- [Performance Benchmarks](#performance-benchmarks)
- [Writing Tests](#writing-tests)
- [CI/CD](#cicd)

## Quick Start

```bash
# Install dependencies
npm install

# Run all TypeScript tests
npm test

# Run Rust tests
cd src-wasm && cargo test

# Run performance benchmarks
cd src-wasm && cargo test --release -- --ignored --nocapture
```

## Test Suites

### TypeScript Tests (55 tests)

Located in `src/__tests__/`:

#### Unit Tests (`unit/`)
- **Large Datasets** (`large-datasets.test.ts`)
  - CSV generation for 10k, 50k, 100k rows
  - Unicode and special character handling
  - Boundary conditions (1-row, single column)
  - Memory usage tracking

#### Integration Tests (`integration/`)
- **Worker-WASM Integration** (`worker-wasm.test.ts`)
  - Web Worker message handling
  - WASM module integration
  - Chunked processing
  - Request/response correlation

- **IndexedDB Integration** (`indexeddb.test.ts`)
  - Chunk storage and retrieval
  - Metadata management
  - Storage quota handling
  - Dataset reconstruction

#### Performance Tests (`performance/`)
- **Diff Performance** (`diff-performance.test.ts`)
  - Data generation benchmarks
  - Memory efficiency tests
  - Scaling characteristics
  - Unicode overhead measurement

### Rust Tests (42 tests)

Located in `src-wasm/src/lib.rs`:

#### Functional Tests (36 tests)
- Basic CSV diff operations
- Header edge cases
- Primary key validation
- Content match mode
- Normalization options
- Malformed CSV handling
- Progress callbacks
- CSV parsing
- Text diff
- Chunked processing

#### Performance Benchmarks (6 tests)
- 10k rows (primary key & content match)
- 100k rows (primary key)
- 1M rows (primary key)
- Unicode handling
- Comprehensive summary

## Running Tests

### TypeScript Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test src/__tests__/unit/large-datasets.test.ts

# Run in watch mode
npm test -- --watch

# Run with UI
npm test -- --ui
```

### Rust Tests

```bash
# Run all functional tests
cd src-wasm && cargo test

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_simple_diff

# Run all tests including benchmarks
cargo test -- --include-ignored

# Run only benchmarks
cargo test --release -- --ignored --nocapture
```

## Performance Benchmarks

### Running Benchmarks

```bash
# Run all benchmarks
cd src-wasm
cargo test --release -- --ignored --nocapture

# Run specific benchmark
cargo test --release benchmark_10k_rows_primary_key -- --ignored --nocapture

# Run benchmark summary
cargo test --release benchmark_summary -- --ignored --nocapture
```

### Expected Results

On a typical development machine:

| Dataset | Primary Key | Content Match | Memory |
|---------|-------------|---------------|--------|
| 10k rows | 50-100ms | 80-120ms | 0.5 MB |
| 50k rows | 300-450ms | 500-700ms | 2.8 MB |
| 100k rows | 600-900ms | 1-1.5s | 5.7 MB |
| 1M rows | 8-12s | N/A | 57 MB |

**Note:** Results vary based on hardware and system load.

### WASM Binary Size Tracking

Track WASM binary size to detect regressions:

```bash
# Build and track size
./scripts/track-wasm-size.sh

# View history
cat WASM_SIZE_HISTORY.md
```

Expected size: ~100-150 KB (optimized release build)

## Writing Tests

### TypeScript Test Template

```typescript
import { describe, it, expect } from 'vitest'

describe('Feature Name', () => {
  describe('Specific Functionality', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test data'
      
      // Act
      const result = processInput(input)
      
      // Assert
      expect(result).toBe('expected output')
    })
  })
})
```

### Rust Test Template

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feature() {
        // Arrange
        let input = "test data";
        
        // Act
        let result = process_input(input);
        
        // Assert
        assert_eq!(result.is_ok(), true);
    }
}
```

### Test Data Generation

Use the test data generator for consistent, reproducible tests:

```typescript
import { generateLargeCsv } from '../utils/test-data-generator'

const csv = generateLargeCsv({
  rows: 10000,
  columns: 5,
  includeUnicode: true,
  seed: 12345, // For reproducibility
})
```

### Best Practices

1. **Use Seeds**: Always use seeds for random data generation
2. **Test Edge Cases**: Include boundary conditions
3. **Mock External Dependencies**: Use mocks for Workers, IndexedDB
4. **Performance Tests**: Mark as such and document expected times
5. **Descriptive Names**: Use clear, descriptive test names
6. **Arrange-Act-Assert**: Follow AAA pattern

## CI/CD

### GitHub Actions Workflow

Tests run automatically on:
- Push to `main` or `develop`
- Pull requests to `main` or `develop`

Workflow jobs:
1. **TypeScript Tests** - Runs vitest with coverage
2. **Rust Tests** - Runs cargo test
3. **WASM Build Size** - Tracks binary size
4. **Performance Regression** - Runs benchmarks

### Local Pre-commit Checks

Before committing, run:

```bash
# Format and lint
npm run check

# Run tests
npm test
cd src-wasm && cargo test

# Run benchmarks (optional but recommended)
cd src-wasm && cargo test --release benchmark_summary -- --ignored --nocapture
```

## Test Coverage Goals

### Current Coverage
- **Rust Core Logic**: 85-90%
- **TypeScript Integration**: 60-70%
- **End-to-End Flows**: 70%

### Coverage Reports

```bash
# TypeScript coverage
npm test -- --coverage

# View HTML report
open coverage/index.html

# Rust coverage (requires tarpaulin)
cd src-wasm
cargo install cargo-tarpaulin
cargo tarpaulin --out Html
open tarpaulin-report.html
```

## Troubleshooting

### Tests Failing Locally

1. **Install dependencies**: `npm install && cd src-wasm && cargo build`
2. **Clear cache**: `npm test -- --clearCache`
3. **Rebuild WASM**: `npm run build:wasm`
4. **Check Node version**: Should be 20+

### Slow Tests

1. **Use watch mode selectively**: `npm test -- --watch`
2. **Run specific suites**: `npm test unit/`
3. **Increase timeout**: Add `timeout: 30000` to test config

### Benchmark Variability

Performance benchmarks can vary ±20% based on:
- System load
- CPU thermal throttling
- Background processes
- First run vs subsequent runs

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Rust Testing Guide](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [Test Coverage Report](./TEST_COVERAGE_REPORT.md)
- [GitHub Actions Workflow](./.github/workflows/test.yml)
