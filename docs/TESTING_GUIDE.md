# Testing Guide for Chunked Processing

## Quick Start Testing

### Prerequisites
- Modern web browser (Chrome, Firefox, or Edge recommended)
- Node.js 20+ (though the app warns about 22.12.0+)
- Built application (`npm run build`)

### Running the Application

```bash
npm run dev
# Opens at http://localhost:3000
```

## Test Scenarios

### Scenario 1: Basic Chunked Mode Test
**Goal**: Verify chunked mode works with small dataset

1. Navigate to the application
2. Load the example data (button in top-right corner)
3. Select **Primary Key** mode
4. Set key column to: `id`
5. Toggle **Chunked Processing** ON
6. Set chunk size to: `5` (to see multiple chunks with example data)
7. Click **Compare Files**

**Expected Results**:
- Progress shows "Chunk 1/2" or similar
- Storage monitor appears below config panel
- Results display correctly
- Storage usage shows data stored

### Scenario 2: Large Dataset Test
**Goal**: Test with 100K+ rows

1. Generate a large CSV file:
```bash
# Create test CSV generator script
cat > /tmp/generate_csv.py << 'EOF'
import csv
import random

with open('/tmp/large_source.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['id', 'name', 'value', 'category'])
    for i in range(100000):
        writer.writerow([
            i,
            f'Item_{i}',
            random.randint(1, 1000),
            random.choice(['A', 'B', 'C', 'D'])
        ])

with open('/tmp/large_target.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['id', 'name', 'value', 'category'])
    for i in range(100000):
        # Modify ~10% of rows
        if random.random() < 0.1:
            writer.writerow([
                i,
                f'Item_{i}_MODIFIED',
                random.randint(1, 1000),
                random.choice(['A', 'B', 'C', 'D'])
            ])
        else:
            writer.writerow([
                i,
                f'Item_{i}',
                random.randint(1, 1000),
                random.choice(['A', 'B', 'C', 'D'])
            ])
EOF

python3 /tmp/generate_csv.py
```

2. Upload generated files to the app
3. Enable chunked processing with 10K chunk size
4. Run comparison

**Expected Results**:
- Processing completes without browser crash
- Progress shows chunk-by-chunk updates
- Results are accurate
- Memory usage remains stable (check browser task manager)

### Scenario 3: Storage Management Test
**Goal**: Test storage monitoring and clearing

1. Complete Scenario 2 (creates stored data)
2. Check Storage Monitor component:
   - Should show non-zero usage
   - Visual progress bar should display
3. Click "Clear All Stored Diffs"
4. Confirm in dialog
5. Verify storage usage drops to 0

**Expected Results**:
- Storage monitor updates correctly
- Clear operation succeeds
- Previous results are removed

### Scenario 4: Chunk Size Optimization
**Goal**: Compare performance with different chunk sizes

Test with same dataset but different chunk sizes:
- 5,000 rows
- 10,000 rows (default)
- 25,000 rows
- 50,000 rows

**Measure**:
- Total processing time
- Browser memory usage (use browser's task manager)
- UI responsiveness

**Expected Results**:
- Smaller chunks: Slower but more responsive
- Larger chunks: Faster but may lag UI briefly
- All sizes should complete successfully

### Scenario 5: Error Handling Test
**Goal**: Test error cases

Test cases:
1. **Missing Primary Key**:
   - Enable chunked mode
   - Set invalid key column name
   - Expected: Error message displayed

2. **Duplicate Primary Keys**:
   - Create CSV with duplicate IDs
   - Expected: Error message about duplicate keys

3. **Storage Quota Exceeded**:
   - If possible, fill up browser storage
   - Expected: Graceful error message

### Scenario 6: Browser Restart Persistence
**Goal**: Verify data persists across sessions

1. Run a chunked diff (Scenario 1 or 2)
2. Note the results
3. Close browser completely
4. Reopen browser and navigate to app
5. Check Storage Monitor

**Expected Results**:
- Storage usage should show previous data
- Can clear old data
- (Note: Current implementation doesn't auto-load previous diffs, just shows they exist)

## Performance Benchmarks

### Expected Performance (approximate)

| Dataset Size | Chunk Size | Expected Time | Memory Usage |
|--------------|------------|---------------|--------------|
| 10K rows     | 10K        | < 5 seconds   | ~50 MB       |
| 100K rows    | 10K        | ~30 seconds   | ~80 MB       |
| 500K rows    | 25K        | ~2-3 minutes  | ~120 MB      |
| 1M rows      | 50K        | ~4-6 minutes  | ~150 MB      |

*Times vary based on hardware and CSV complexity*

## Browser Developer Tools

### Monitoring Memory
1. Open Chrome DevTools (F12)
2. Go to Performance or Memory tab
3. Start recording
4. Run comparison
5. Observe memory profile

### Inspecting IndexedDB
1. Open DevTools (F12)
2. Go to Application tab
3. Expand IndexedDB
4. Look for "csv-diff-viewer" database
5. Inspect "diff-results" and "metadata" stores

### Network Tab
- Verify no network requests during diff (everything is client-side)

## Troubleshooting

### Browser Crashes
- Reduce chunk size to 5,000 or less
- Close other tabs
- Try a different browser

### Slow Performance
- Increase chunk size
- Check if browser is throttling (battery saver mode)
- Close DevTools during processing

### Storage Errors
- Clear browser data
- Check available disk space
- Try incognito/private mode

## Validation Checklist

- [ ] Example data loads and compares successfully
- [ ] Chunked mode toggle works
- [ ] Chunk size input accepts values
- [ ] Progress shows chunk numbers
- [ ] Storage monitor displays usage
- [ ] Clear storage button works
- [ ] 100K+ rows process successfully
- [ ] Memory remains stable during processing
- [ ] No console errors
- [ ] Results are accurate
- [ ] UI remains responsive
- [ ] Linter passes (npm run lint)
- [ ] Build succeeds (npm run build)

## Reporting Issues

When reporting issues, include:
1. Browser and version
2. Dataset size (number of rows)
3. Chunk size used
4. Error messages (from console)
5. Browser memory usage (from task manager)
6. Steps to reproduce
