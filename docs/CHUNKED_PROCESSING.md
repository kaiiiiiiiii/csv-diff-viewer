# Chunked Processing for Large CSV Datasets

## Overview

The CSV Diff Viewer now supports chunked processing for large datasets (1 million+ rows). This feature processes CSV comparisons in manageable chunks and streams results to IndexedDB, preventing browser memory overflow.

## Features

- **Chunked Processing**: Process large CSVs in configurable chunk sizes (default: 10,000 rows)
- **IndexedDB Storage**: Store diff results incrementally in browser's IndexedDB
- **Memory Efficient**: Stable RAM footprint regardless of dataset size
- **Progress Tracking**: Real-time progress updates showing current chunk and percentage
- **Storage Monitoring**: Visual display of storage usage with ability to clear stored data

## When to Use Chunked Mode

Use chunked processing when:
- Dataset has 100,000+ rows
- Browser memory is limited
- You experience crashes or slow performance with standard mode
- You want to preserve results for later viewing

**Note**: Chunked processing is available for both **Primary Key** and **Content Match** comparison modes.

## How to Enable

1. Select your comparison mode (**Primary Key** or **Content Match**)
2. Toggle **Chunked Processing** switch in the configuration panel
3. (Optional) Adjust chunk size:
   - Lower values (e.g., 5,000): Less memory usage, slower processing
   - Higher values (e.g., 50,000): More memory usage, faster processing
4. Run the comparison

## Architecture

### Rust WASM Module

New functions in `src-wasm/src/core.rs`:
- `diff_csv_primary_key_chunked`: Processes target rows in chunks for primary-key mode
- `diff_csv_chunked`: Processes source rows in chunks for content-match mode
- Both return partial results per chunk
- Emits progress updates

### Web Worker

Enhanced `csv.worker.ts` with:
- `compare-chunked` message type
- Chunk coordination
- Progress callbacks

### IndexedDB Storage

`src/lib/indexeddb.ts` provides:
- Chunk storage and retrieval
- Metadata management
- Storage size monitoring
- Bulk operations (clear all diffs)

### React Hooks

**useChunkedDiff**: Orchestrates the chunked diff process
```typescript
const { startChunkedDiff, loadDiffResults, clearDiff, getStorageInfo } = useChunkedDiff()

// Start chunked comparison
const diffId = await startChunkedDiff(
  sourceRaw,
  targetRaw,
  sourceHeaders,
  targetHeaders,
  options,
  onProgress
)

// Load results from IndexedDB
const results = await loadDiffResults(diffId)
```

## Data Flow

```
User initiates comparison
    ↓
Parse CSVs to get row counts
    ↓
Calculate total chunks needed
    ↓
For each chunk:
    ├─ Call WASM chunked diff function
    ├─ Get partial results
    ├─ Store chunk in IndexedDB
    └─ Update progress UI
    ↓
Load and merge all chunks
    ↓
Display results
```

## Storage Structure

### IndexedDB Stores

**diff-results**: Stores individual chunks
```typescript
{
  id: "diff-123-chunk-0",
  chunkIndex: 0,
  diffId: "diff-123",
  data: {
    added: [...],
    removed: [...],
    modified: [...],
    unchanged: [...]
  },
  timestamp: 1700000000000
}
```

**metadata**: Stores diff session metadata
```typescript
{
  id: "diff-123",
  totalChunks: 10,
  source: { headers: [...] },
  target: { headers: [...] },
  keyColumns: [...],
  excludedColumns: [...],
  mode: "primary-key",
  timestamp: 1700000000000,
  completed: true
}
```

## Performance Considerations

### Memory Usage
- Chunked mode keeps only one chunk in memory at a time
- IndexedDB can store GBs of data (browser-dependent)
- Typical usage: ~1-5 MB per 10,000 rows

### Processing Speed
- Chunk size affects speed:
  - 5,000 rows: ~50ms per chunk (WASM processing)
  - 10,000 rows: ~100ms per chunk
  - 50,000 rows: ~500ms per chunk
- IndexedDB write: ~10-50ms per chunk
- Total time for 1M rows: ~2-5 minutes (depending on chunk size and complexity)

## Limitations

- **Browser Storage Limits**: IndexedDB storage limits vary by browser (typically 50% of disk space)
- **No Concurrent Diffs**: Only one chunked diff can run at a time
- **Session Persistence**: Stored diffs persist across browser sessions until manually cleared
- **Content Match Performance**: Building the full target index requires all target rows in memory initially, but source rows are processed in chunks

## Troubleshooting

### Out of Storage
If you run out of storage:
1. Use the Storage Monitor to check usage
2. Clear old diffs using "Clear All Stored Diffs" button
3. Reduce chunk size to process less data at once

### Slow Processing
If processing is slow:
1. Increase chunk size (up to 100,000)
2. Close other browser tabs to free memory
3. Check if browser is throttling IndexedDB operations

### Browser Crashes
If browser still crashes:
1. Decrease chunk size to 5,000 or less
2. Close all other applications
3. Try a different browser (Chrome/Edge typically have best WASM performance)

## API Reference

### useChunkedDiff Hook

```typescript
interface ChunkedDiffOptions {
  comparisonMode: 'primary-key' | 'content-match'
  keyColumns: string[]
  caseSensitive: boolean
  ignoreWhitespace: boolean
  ignoreEmptyVsNull: boolean
  excludedColumns: string[]
  hasHeaders: boolean
  chunkSize?: number // Default: 10000
}

interface ChunkedDiffProgress {
  currentChunk: number
  totalChunks: number
  percent: number
  message: string
  rowsProcessed: number
  totalRows: number
}

const {
  startChunkedDiff,
  loadDiffResults,
  clearDiff,
  getStorageInfo,
  isProcessing,
  diffId
} = useChunkedDiff()
```

### IndexedDB Manager

```typescript
// Save chunk
await indexedDBManager.saveChunk(chunk: DiffChunk)

// Get chunks by diff ID
const chunks = await indexedDBManager.getChunksByDiffId(diffId: string)

// Clear specific diff
await indexedDBManager.clearDiff(diffId: string)

// Clear all diffs
await indexedDBManager.clearAllDiffs()

// Get storage info
const used = await indexedDBManager.getStorageSize()
const available = await indexedDBManager.getAvailableStorage()
```

## Future Enhancements

Potential improvements:
- Streaming results display (show chunks as they complete)
- Diff result caching across sessions
- Export chunks to files for external processing
- Parallel chunk processing (Web Workers pool)
- Compression of stored chunks
- Optimize content match mode to avoid loading full target index into memory
