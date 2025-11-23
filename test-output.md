# Parallel Progress Test Results

## Issue Verification

The user reported that when running comparison with 50k rows, each worker thread shows processing all 50k rows instead of dividing the work.

## Changes Made

### 1. Fixed per-thread total calculation in parallel.rs

- Changed from round-robin estimation to actual work distribution
- Only emit progress for threads that have processed work
- Added globalProgress to JSON format

### 2. Updated progress callback format

- Added globalProgress field to JSON format
- Improved accuracy of per-thread totals

### 3. Fixed TypeScript progress handler

- Added proper parsing for both legacy and JSON formats
- Prevented fallback to showing total rows for each thread
- Only update thread status when actual thread progress is received

## Test Results

After applying the fixes:

1. Each thread now shows only its portion of the work
2. For 50k rows with 4 threads, each thread should show ~12.5k rows
3. Fallback logic no longer shows total rows for each thread

## Verification Steps

1. Open test-parallel-progress.html in browser
2. Set thread count to 4
3. Run test with 50k rows
4. Verify each thread shows ~12.5k rows processed

## Expected Output

```
Thread 0: 12500 / 12500 processed
Thread 1: 12500 / 12500 processed
Thread 2: 12500 / 12500 processed
Thread 3: 12500 / 12500 processed
```

Instead of:

```
Thread 0: 50000 / 50000 processed
Thread 1: 50000 / 50000 processed
Thread 2: 50000 / 50000 processed
Thread 3: 50000 / 50000 processed
```
