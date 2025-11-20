import { parseCSV } from '../lib/csv-parser'
import { compareByContent, compareByPrimaryKey } from '../lib/comparison-engine'
import init, { diff_csv } from '../../src-wasm/pkg/csv_diff_wasm'

const ctx: Worker = self as any
let wasmInitialized = false

async function initWasm() {
  if (!wasmInitialized) {
    await init()
    wasmInitialized = true
  }
}

ctx.onmessage = async function (e) {
  const { requestId, type, data } = e.data || {}

  if (!requestId) {
    ctx.postMessage({
      requestId: 0,
      type: 'error',
      data: { message: 'Worker request missing requestId.' },
    })
    return
  }

  const emitProgress = (progress: number, message: string) => {
    ctx.postMessage({
      requestId,
      type: 'progress',
      data: {
        percent: progress,
        message: message,
      },
    })
  }

  try {
    if (type === 'parse') {
      const { csvText, name, hasHeaders } = data
      const result = await parseCSV(csvText, hasHeaders !== false)
      ctx.postMessage({
        requestId,
        type: 'parse-complete',
        data: { name, headers: result.headers, rows: result.rows },
      })
    } else if (type === 'compare') {
      const {
        source,
        target,
        comparisonMode,
        keyColumns,
        caseSensitive,
        ignoreWhitespace,
        excludedColumns,
        sourceRaw,
        targetRaw,
        hasHeaders,
      } = data

      let results
      if (comparisonMode === 'primary-key') {
        results = await compareByPrimaryKey(
          source,
          target,
          keyColumns,
          caseSensitive,
          ignoreWhitespace,
          excludedColumns,
          emitProgress,
        )
      } else {
        // Use WASM if raw data is available and we are in content match mode
        if (sourceRaw && targetRaw) {
          await initWasm()
          emitProgress(0, 'Starting WASM comparison...')
          results = diff_csv(
            sourceRaw,
            targetRaw,
            caseSensitive,
            ignoreWhitespace,
            excludedColumns,
            hasHeaders !== false,
            (percent: number, message: string) =>
              emitProgress(percent, message),
          )
          emitProgress(100, 'WASM comparison complete')
        } else {
          results = await compareByContent(
            source,
            target,
            caseSensitive,
            ignoreWhitespace,
            excludedColumns,
            emitProgress,
          )
        }
      }

      ctx.postMessage({ requestId, type: 'compare-complete', data: results })
    }
  } catch (error: any) {
    ctx.postMessage({
      requestId,
      type: 'error',
      data: { message: error.message, stack: error.stack },
    })
  }
}
