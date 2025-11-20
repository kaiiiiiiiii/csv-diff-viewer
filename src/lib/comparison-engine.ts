import { diffWords } from 'diff'
import type { Change } from 'diff'

export interface DiffResult {
  added: Array<any>
  removed: Array<any>
  modified: Array<any>
  unchanged: Array<any>
  source: { headers: Array<string>; rows: Array<any> }
  target: { headers: Array<string>; rows: Array<any> }
  keyColumns: Array<string>
  excludedColumns: Array<string>
  mode: 'primary-key' | 'content-match'
}

export interface DiffChange {
  added: boolean
  removed: boolean
  value: string
}

export type ProgressCallback = (percent: number, message: string) => void

function normalizeValue(
  value: any,
  caseSensitive: boolean,
  ignoreWhitespace: boolean,
): string {
  if (value === null || value === undefined) return ''
  let strValue = String(value)
  if (ignoreWhitespace) strValue = strValue.trim()
  if (!caseSensitive) strValue = strValue.toLowerCase()
  return strValue
}

function computeDiff(
  oldVal: any,
  newVal: any,
  caseSensitive: boolean,
  ignoreWhitespace: boolean,
): Array<Change> {
  let str1 = oldVal === null || oldVal === undefined ? '' : String(oldVal)
  let str2 = newVal === null || newVal === undefined ? '' : String(newVal)

  if (ignoreWhitespace) {
    str1 = str1.trim()
    str2 = str2.trim()
  }

  return diffWords(str1, str2, { ignoreCase: !caseSensitive })
}

// WASM-enabled version of computeDiff for performance
export async function computeDiffWasm(
  oldVal: any,
  newVal: any,
  caseSensitive: boolean,
  ignoreWhitespace: boolean,
): Promise<Array<DiffChange>> {
  try {
    // Dynamic import to avoid dependency issues
    const wasmModule = await import('../../src-wasm/pkg/csv_diff_wasm')

    let str1 = oldVal === null || oldVal === undefined ? '' : String(oldVal)
    let str2 = newVal === null || newVal === undefined ? '' : String(newVal)

    if (ignoreWhitespace) {
      str1 = str1.trim()
      str2 = str2.trim()
    }

    // Use WASM for word-level diff
    return wasmModule.diff_text(str1, str2, caseSensitive)
  } catch {
    // Fallback to TypeScript implementation
    const tsDiff = computeDiff(oldVal, newVal, caseSensitive, ignoreWhitespace)
    return tsDiff.map((change) => ({
      added: change.added || false,
      removed: change.removed || false,
      value: change.value || '',
    }))
  }
}

function getRowKey(row: any, keyColumns: Array<string>): string {
  return keyColumns.map((col) => row[col] || '').join('|')
}

function getRowFingerprint(
  row: any,
  headers: Array<string>,
  caseSensitive: boolean,
  ignoreWhitespace: boolean,
  excludedColumns: Array<string> = [],
): string {
  return headers
    .filter((h) => !excludedColumns.includes(h))
    .map((h) => normalizeValue(row[h] || '', caseSensitive, ignoreWhitespace))
    .join('||')
}

function findBestMatch(
  sourceRow: any,
  targetRows: IterableIterator<any>,
  headers: Array<string>,
  caseSensitive: boolean,
  ignoreWhitespace: boolean,
  excludedColumns: Array<string> = [],
) {
  let bestMatch = null
  let bestScore = 0

  const sourceFingerprint = getRowFingerprint(
    sourceRow,
    headers,
    caseSensitive,
    ignoreWhitespace,
    excludedColumns,
  )

  for (const targetRow of targetRows) {
    const targetFingerprint = getRowFingerprint(
      targetRow,
      headers,
      caseSensitive,
      ignoreWhitespace,
      excludedColumns,
    )

    if (sourceFingerprint === targetFingerprint) {
      return { row: targetRow, score: 1.0 }
    }

    let matchingFields = 0
    let totalFields = 0
    for (const header of headers) {
      if (excludedColumns.includes(header)) continue
      totalFields++
      const sourceVal = normalizeValue(
        sourceRow[header] || '',
        caseSensitive,
        ignoreWhitespace,
      )
      const targetVal = normalizeValue(
        targetRow[header] || '',
        caseSensitive,
        ignoreWhitespace,
      )
      if (sourceVal === targetVal) {
        matchingFields++
      }
    }

    const score = totalFields > 0 ? matchingFields / totalFields : 0
    if (score > bestScore) {
      bestScore = score
      bestMatch = targetRow
    }
  }

  return bestScore > 0.5 ? { row: bestMatch, score: bestScore } : null
}

export async function compareByPrimaryKey(
  source: { headers: Array<string>; rows: Array<any> },
  target: { headers: Array<string>; rows: Array<any> },
  keyColumns: Array<string>,
  caseSensitive: boolean,
  ignoreWhitespace: boolean,
  excludedColumns: Array<string> = [],
  progressCallback: ProgressCallback | null = null,
): Promise<DiffResult> {
  // Validate key columns
  for (const key of keyColumns) {
    if (!source.headers.includes(key)) {
      throw new Error(
        `Primary key column "${key}" not found in source dataset.`,
      )
    }
    if (!target.headers.includes(key)) {
      throw new Error(
        `Primary key column "${key}" not found in target dataset.`,
      )
    }
  }

  return new Promise((resolve, reject) => {
    ;(async () => {
      try {
        const sourceMap = new Map<string, any>()
        const targetMap = new Map<string, any>()

        // Optimized parallel batch processing
        const BATCH_SIZE = 1000
        const PARALLEL_BATCHES = 4

        // Build source map with parallel batches
        for (
          let i = 0;
          i < source.rows.length;
          i += BATCH_SIZE * PARALLEL_BATCHES
        ) {
          const batchPromises = []

          for (
            let p = 0;
            p < PARALLEL_BATCHES && i + p * BATCH_SIZE < source.rows.length;
            p++
          ) {
            const start = i + p * BATCH_SIZE
            const end = Math.min(start + BATCH_SIZE, source.rows.length)
            const batch = source.rows.slice(start, end)

            batchPromises.push(
              Promise.resolve().then(() => {
                const localMap = new Map<string, any>()
                for (const row of batch) {
                  const key = getRowKey(row, keyColumns)
                  if (sourceMap.has(key) || localMap.has(key)) {
                    throw new Error(
                      `Duplicate Primary Key found in source: "${key}". Primary Keys must be unique.`,
                    )
                  }
                  localMap.set(key, row)
                }
                return localMap
              }),
            )
          }

          const localMaps = await Promise.all(batchPromises)
          localMaps.forEach((localMap) => {
            localMap.forEach((value, key) => {
              if (sourceMap.has(key)) {
                throw new Error(
                  `Duplicate Primary Key found in source: "${key}". Primary Keys must be unique.`,
                )
              }
              sourceMap.set(key, value)
            })
          })

          if (progressCallback) {
            const processed = Math.min(
              i + BATCH_SIZE * PARALLEL_BATCHES,
              source.rows.length,
            )
            progressCallback(
              (processed / (source.rows.length + target.rows.length)) * 100,
              `Building source map: ${processed}/${source.rows.length} rows`,
            )
            await new Promise((r) => setTimeout(r, 0)) // Yield to UI
          }
        }

        // Build target map with parallel batches
        for (
          let i = 0;
          i < target.rows.length;
          i += BATCH_SIZE * PARALLEL_BATCHES
        ) {
          const batchPromises = []

          for (
            let p = 0;
            p < PARALLEL_BATCHES && i + p * BATCH_SIZE < target.rows.length;
            p++
          ) {
            const start = i + p * BATCH_SIZE
            const end = Math.min(start + BATCH_SIZE, target.rows.length)
            const batch = target.rows.slice(start, end)

            batchPromises.push(
              Promise.resolve().then(() => {
                const localMap = new Map<string, any>()
                for (const row of batch) {
                  const key = getRowKey(row, keyColumns)
                  if (targetMap.has(key) || localMap.has(key)) {
                    throw new Error(
                      `Duplicate Primary Key found in target: "${key}". Primary Keys must be unique.`,
                    )
                  }
                  localMap.set(key, row)
                }
                return localMap
              }),
            )
          }

          const localMaps = await Promise.all(batchPromises)
          localMaps.forEach((localMap) => {
            localMap.forEach((value, key) => {
              if (targetMap.has(key)) {
                throw new Error(
                  `Duplicate Primary Key found in target: "${key}". Primary Keys must be unique.`,
                )
              }
              targetMap.set(key, value)
            })
          })

          if (progressCallback) {
            const processed = Math.min(
              i + BATCH_SIZE * PARALLEL_BATCHES,
              target.rows.length,
            )
            progressCallback(
              ((source.rows.length + processed) /
                (source.rows.length + target.rows.length)) *
                100,
              `Building target map: ${processed}/${target.rows.length} rows`,
            )
            await new Promise((r) => setTimeout(r, 0)) // Yield to UI
          }
        }

        const results: DiffResult = {
          added: [],
          removed: [],
          modified: [],
          unchanged: [],
          source: source,
          target: target,
          keyColumns: keyColumns,
          excludedColumns: excludedColumns,
          mode: 'primary-key',
        }

        // Find removed rows in parallel
        const sourceKeys = Array.from(sourceMap.keys())
        for (
          let i = 0;
          i < sourceKeys.length;
          i += BATCH_SIZE * PARALLEL_BATCHES
        ) {
          const batchPromises = []

          for (
            let p = 0;
            p < PARALLEL_BATCHES && i + p * BATCH_SIZE < sourceKeys.length;
            p++
          ) {
            const start = i + p * BATCH_SIZE
            const end = Math.min(start + BATCH_SIZE, sourceKeys.length)
            const batchKeys = sourceKeys.slice(start, end)

            batchPromises.push(
              Promise.resolve().then(() => {
                return batchKeys
                  .filter((key) => !targetMap.has(key))
                  .map((key) => ({ key, sourceRow: sourceMap.get(key) }))
              }),
            )
          }

          const removedBatches = await Promise.all(batchPromises)
          removedBatches.forEach((batch) => results.removed.push(...batch))

          await new Promise((r) => setTimeout(r, 0))
        }

        // Compare target rows in parallel batches
        const targetKeys = Array.from(targetMap.keys())
        for (
          let i = 0;
          i < targetKeys.length;
          i += BATCH_SIZE * PARALLEL_BATCHES
        ) {
          const batchPromises = []

          for (
            let p = 0;
            p < PARALLEL_BATCHES && i + p * BATCH_SIZE < targetKeys.length;
            p++
          ) {
            const start = i + p * BATCH_SIZE
            const end = Math.min(start + BATCH_SIZE, targetKeys.length)
            const batchKeys = targetKeys.slice(start, end)

            batchPromises.push(
              Promise.resolve().then(async () => {
                const batchResults: {
                  added: Array<any>
                  modified: Array<any>
                  unchanged: Array<any>
                } = { added: [], modified: [], unchanged: [] }

                for (const key of batchKeys) {
                  const targetRow = targetMap.get(key)

                  if (!sourceMap.has(key)) {
                    batchResults.added.push({ key, targetRow })
                  } else {
                    const sourceRow = sourceMap.get(key)
                    const differences: Array<any> = []

                    for (const header of source.headers) {
                      if (excludedColumns.includes(header)) continue

                      const sourceVal = normalizeValue(
                        sourceRow[header] || '',
                        caseSensitive,
                        ignoreWhitespace,
                      )
                      const targetVal = normalizeValue(
                        targetRow[header] || '',
                        caseSensitive,
                        ignoreWhitespace,
                      )

                      if (sourceVal !== targetVal) {
                        differences.push({
                          column: header,
                          oldValue: sourceRow[header] || '',
                          newValue: targetRow[header] || '',
                        })
                      }
                    }

                    if (differences.length > 0) {
                      // Use WASM for word-level diffs when possible
                      const enhancedDifferences = await Promise.all(
                        differences.map(async (diff) => ({
                          ...diff,
                          diff: await computeDiffWasm(
                            diff.oldValue,
                            diff.newValue,
                            caseSensitive,
                            ignoreWhitespace,
                          ),
                        })),
                      )

                      batchResults.modified.push({
                        key,
                        sourceRow,
                        targetRow,
                        differences: enhancedDifferences,
                      })
                    } else {
                      batchResults.unchanged.push({ key, row: sourceRow })
                    }
                  }
                }

                return batchResults
              }),
            )
          }

          const batchResults = await Promise.all(batchPromises)
          batchResults.forEach((batch) => {
            results.added.push(...batch.added)
            results.modified.push(...batch.modified)
            results.unchanged.push(...batch.unchanged)
          })

          if (progressCallback) {
            const processed = Math.min(
              i + BATCH_SIZE * PARALLEL_BATCHES,
              targetKeys.length,
            )
            const progress = 50 + (processed / targetKeys.length) * 50
            progressCallback(
              progress,
              `Comparing rows: ${processed}/${targetKeys.length}`,
            )
            await new Promise((r) => setTimeout(r, 0)) // Yield to UI
          }
        }

        if (progressCallback) {
          progressCallback(100, 'Comparison complete')
        }

        resolve(results)
      } catch (error) {
        reject(error)
      }
    })()
  })
}

export async function compareByContent(
  source: { headers: Array<string>; rows: Array<any> },
  target: { headers: Array<string>; rows: Array<any> },
  caseSensitive: boolean,
  ignoreWhitespace: boolean,
  excludedColumns: Array<string> = [],
  progressCallback: ProgressCallback | null = null,
): Promise<DiffResult> {
  return new Promise((resolve) => {
    ;(async () => {
      const results: DiffResult = {
        added: [],
        removed: [],
        modified: [],
        unchanged: [],
        source: source,
        target: target,
        keyColumns: [],
        excludedColumns: excludedColumns,
        mode: 'content-match',
      }

      // Use Map for O(1) deletions
      const unmatchedTargetMap = new Map<number, any>()
      target.rows.forEach((row, index) => {
        unmatchedTargetMap.set(index, row)
      })

      const unmatchedSourceRows: Array<any> = []
      let rowCounter = 1

      const BATCH_SIZE = 100 // Smaller batch for content matching due to O(n*m) complexity

      // Process source rows in batches for UI responsiveness
      for (let i = 0; i < source.rows.length; i += BATCH_SIZE) {
        const start = i
        const end = Math.min(start + BATCH_SIZE, source.rows.length)
        const batch = source.rows.slice(start, end)

        // Process batch sequentially to avoid race conditions
        for (const sourceRow of batch) {
          const match = findBestMatch(
            sourceRow,
            unmatchedTargetMap.values(),
            source.headers,
            caseSensitive,
            ignoreWhitespace,
            excludedColumns,
          )

          if (match && match.score === 1.0) {
            const key = `Row ${rowCounter}`
            results.unchanged.push({ key, row: sourceRow })
            // Remove from map
            for (const [mapKey, mapRow] of unmatchedTargetMap) {
              if (mapRow === match.row) {
                unmatchedTargetMap.delete(mapKey)
                break
              }
            }
          } else if (match && match.score > 0.5) {
            const key = `Row ${rowCounter}`
            const differences: Array<any> = []

            source.headers.forEach((header) => {
              if (excludedColumns.includes(header)) return

              const sourceVal = normalizeValue(
                sourceRow[header] || '',
                caseSensitive,
                ignoreWhitespace,
              )
              const targetVal = normalizeValue(
                match.row[header] || '',
                caseSensitive,
                ignoreWhitespace,
              )

              if (sourceVal !== targetVal) {
                differences.push({
                  column: header,
                  oldValue: sourceRow[header] || '',
                  newValue: match.row[header] || '',
                })
              }
            })

            // Use WASM for word-level diffs when possible
            const enhancedDifferences = await Promise.all(
              differences.map(async (diff) => ({
                ...diff,
                diff: await computeDiffWasm(
                  diff.oldValue,
                  diff.newValue,
                  caseSensitive,
                  ignoreWhitespace,
                ),
              })),
            )

            results.modified.push({
              key,
              sourceRow,
              targetRow: match.row,
              differences: enhancedDifferences,
            })
            // Remove from map
            for (const [mapKey, mapRow] of unmatchedTargetMap) {
              if (mapRow === match.row) {
                unmatchedTargetMap.delete(mapKey)
                break
              }
            }
          } else {
            unmatchedSourceRows.push(sourceRow)
          }
          rowCounter++
        }

        if (progressCallback) {
          const processed = Math.min(i + BATCH_SIZE, source.rows.length)
          const progress = (processed / source.rows.length) * 80
          progressCallback(
            progress,
            `Matching rows: ${processed}/${source.rows.length} (${unmatchedTargetMap.size} unmatched)`,
          )
          await new Promise((r) => setTimeout(r, 0)) // Yield to UI
        }
      }

      unmatchedSourceRows.forEach((row, index) => {
        const key = `Removed ${index + 1}`
        results.removed.push({ key, sourceRow: row })
      })

      let addedIndex = 1
      for (const [, row] of unmatchedTargetMap) {
        const key = `Added ${addedIndex}`
        results.added.push({ key, targetRow: row })
        addedIndex++
      }

      if (progressCallback) {
        progressCallback(100, 'Comparison complete')
      }

      resolve(results)
    })()
  })
}
