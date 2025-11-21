import init, {
  CsvDiffer,
  diff_csv,
  diff_csv_primary_key,
  parse_csv,
} from '../../src-wasm/pkg/csv_diff_wasm'

const ctx: Worker = self as any
let wasmInitialized = false
let differ: CsvDiffer | null = null

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
    await initWasm()

    if (type === 'parse') {
      const { csvText, name, hasHeaders } = data
      const result = parse_csv(csvText, hasHeaders !== false)
      ctx.postMessage({
        requestId,
        type: 'parse-complete',
        data: { name, headers: result.headers, rows: result.rows },
      })
    } else if (type === 'compare') {
      const {
        comparisonMode,
        keyColumns,
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        excludedColumns,
        sourceRaw,
        targetRaw,
        hasHeaders,
      } = data

      if (!sourceRaw || !targetRaw) {
        throw new Error('Raw CSV data is required for comparison.')
      }

      let results
      if (comparisonMode === 'primary-key') {
        emitProgress(0, 'Starting comparison (Primary Key)...')
        results = diff_csv_primary_key(
          sourceRaw,
          targetRaw,
          keyColumns,
          caseSensitive,
          ignoreWhitespace,
          ignoreEmptyVsNull,
          excludedColumns,
          hasHeaders !== false,
          (percent: number, message: string) => emitProgress(percent, message),
        )
        emitProgress(100, 'Comparison complete')
      } else {
        emitProgress(0, 'Starting comparison (Content Match)...')
        results = diff_csv(
          sourceRaw,
          targetRaw,
          caseSensitive,
          ignoreWhitespace,
          ignoreEmptyVsNull,
          excludedColumns,
          hasHeaders !== false,
          (percent: number, message: string) => emitProgress(percent, message),
        )
        emitProgress(100, 'Comparison complete')
      }

      ctx.postMessage({ requestId, type: 'compare-complete', data: results })
    } else if (type === 'init-differ') {
      const {
        sourceRaw,
        targetRaw,
        comparisonMode,
        keyColumns,
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        excludedColumns,
        hasHeaders,
      } = data

      if (differ) {
        differ.free()
        differ = null
      }

      differ = new CsvDiffer(
        sourceRaw,
        targetRaw,
        comparisonMode,
        keyColumns,
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        excludedColumns,
        hasHeaders !== false,
      )

      ctx.postMessage({
        requestId,
        type: 'init-differ-complete',
        data: { success: true },
      })
    } else if (type === 'diff-chunk') {
      const { chunkStart, chunkSize } = data

      if (!differ) {
        throw new Error('Differ not initialized')
      }

      const results = differ.diff_chunk(
        chunkStart,
        chunkSize,
        (percent: number, message: string) => emitProgress(percent, message),
      )

      ctx.postMessage({ requestId, type: 'diff-chunk-complete', data: results })
    } else if (type === 'cleanup-differ') {
      if (differ) {
        differ.free()
        differ = null
      }
      ctx.postMessage({
        requestId,
        type: 'cleanup-differ-complete',
        data: { success: true },
      })
    }
  } catch (error: any) {
    ctx.postMessage({
      requestId,
      type: 'error',
      data: { message: error.message, stack: error.stack },
    })
  }
}
