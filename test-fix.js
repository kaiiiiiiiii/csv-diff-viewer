// Simple test to verify parallel progress fix
// This script will check if the per-thread totals are calculated correctly

import initWasm, { init_wasm_thread_pool, diff_csv_primary_key_parallel } from './src-wasm/pkg/csv_diff_wasm.js';

function createTestCSV(rowCount, prefix = 'A') {
    let csv = 'Id,Name,Value,Category\n';
    for (let i = 1; i <= rowCount; i++) {
        csv += `${i},${prefix}-Name-${i},${Math.random() * 100},${['X', 'Y', 'Z'][i % 3]}\n`;
    }
    return csv;
}

async function testParallelProgress() {
    console.log('=== Testing Parallel Progress Fix ===');
    
    // Initialize WASM
    await initWasm();
    console.log('WASM initialized');
    
    // Test parameters
    const rowCount = 50000;
    const threadCount = 4;
    
    // Initialize thread pool
    init_wasm_thread_pool(threadCount);
    console.log(`Thread pool initialized with ${threadCount} threads`);
    
    // Create test CSVs
    console.log(`Creating test CSVs with ${rowCount} rows each...`);
    const sourceCSV = createTestCSV(rowCount, 'A');
    const targetCSV = createTestCSV(rowCount, 'B');
    
    // Track thread progress
    const threadProgress = new Map();
    let globalProgressMessages = [];
    let threadProgressMessages = [];
    
    console.log('\n=== Running Primary Key Comparison ===');
    
    const result = diff_csv_primary_key_parallel(
        sourceCSV,
        targetCSV,
        ['Id'],
        false,  // case_sensitive
        false,  // ignore_whitespace
        false,  // ignore_empty_vs_null
        [],     // excluded_columns
        true,   // has_headers
        (percent, message) => {
            // Parse THREAD_PROGRESS messages
            if (typeof message === 'string') {
                if (message.startsWith('THREAD_PROGRESS|')) {
                    const parts = message.split('|');
                    if (parts.length === 4) {
                        const threadId = parseInt(parts[1], 10);
                        const processed = parseInt(parts[2], 10);
                        const total = parseInt(parts[3], 10);
                        
                        if (!isNaN(threadId)) {
                            threadProgressMessages.push({
                                threadId,
                                processed,
                                total,
                                message: message
                            });
                            
                            if (!threadProgress.has(threadId)) {
                                threadProgress.set(threadId, { processed: 0, total: total });
                            }
                            threadProgress.get(threadId).processed = processed;
                        }
                    }
                }
                else if (message.startsWith('THREAD_PROGRESS_JSON|')) {
                    const jsonStr = message.split('|', 2)[1];
                    try {
                        const data = JSON.parse(jsonStr);
                        if (typeof data.threadId === 'number') {
                            threadProgressMessages.push({
                                threadId: data.threadId,
                                processed: data.processed,
                                total: data.perThreadTotal,
                                globalProgress: data.globalProgress,
                                message: message
                            });
                            
                            if (!threadProgress.has(data.threadId)) {
                                threadProgress.set(data.threadId, { 
                                    processed: data.processed, 
                                    total: data.perThreadTotal 
                                });
                            }
                            threadProgress.get(data.threadId).processed = data.processed;
                        }
                    } catch (e) {
                        console.error('Error parsing JSON:', e.message);
                    }
                }
                else {
                    // Global progress message
                    globalProgressMessages.push({ percent, message });
                    if (percent % 10 < 1 || message.includes('Complete')) {
                        console.log(`[${percent.toFixed(1)}%] ${message}`);
                    }
                }
            }
        }
    );
    
    console.log('\n=== Results ===');
    console.log(`Added: ${result.added.length}`);
    console.log(`Removed: ${result.removed.length}`);
    console.log(`Modified: ${result.modified.length}`);
    console.log(`Unchanged: ${result.unchanged.length}`);
    
    console.log('\n=== Thread Progress Analysis ===');
    const expectedPerThread = Math.ceil(rowCount / threadCount);
    console.log(`Expected rows per thread: ${expectedPerThread}`);
    
    let allThreadsCorrect = true;
    for (let i = 0; i < threadCount; i++) {
        const progress = threadProgress.get(i);
        if (progress) {
            const isCorrect = progress.total <= expectedPerThread + 1;
            console.log(`Thread ${i}: ${progress.processed} / ${progress.total} ${isCorrect ? '✓' : '✗'}`);
            if (!isCorrect) {
                allThreadsCorrect = false;
                console.log(`  Expected: ~${expectedPerThread}, Got: ${progress.total}`);
            }
        } else {
            console.log(`Thread ${i}: No progress data received`);
            allThreadsCorrect = false;
        }
    }
    
    console.log('\n=== Fix Verification ===');
    if (allThreadsCorrect) {
        console.log('✓ SUCCESS: Each thread shows only its portion of the work');
        console.log('✓ The fix is working correctly!');
    } else {
        console.log('✗ FAILURE: Threads still showing incorrect totals');
        console.log('✗ The fix needs more work');
    }
    
    // Check if we got thread-specific messages
    console.log(`\nTotal thread progress messages: ${threadProgressMessages.length}`);
    console.log(`Total global progress messages: ${globalProgressMessages.length}`);
    
    if (threadProgressMessages.length > 0) {
        console.log('✓ Thread-specific progress messages are being sent');
    } else {
        console.log('✗ No thread-specific progress messages received');
    }
}

// Run the test
testParallelProgress().catch(console.error);