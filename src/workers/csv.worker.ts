import init, {
  diff_csv,
  diff_csv_primary_key,
  diff_csv_primary_key_chunked,
  parse_csv,
} from '../../src-wasm/pkg/csv_diff_wasm'

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
        emitProgress(0, 'Starting WASM comparison (Primary Key)...')
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
        emitProgress(100, 'WASM comparison complete')
      } else {
        emitProgress(0, 'Starting WASM comparison...')
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
        emitProgress(100, 'WASM comparison complete')
      }

      ctx.postMessage({ requestId, type: 'compare-complete', data: results })
    } else if (type === 'compare-chunked') {
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
        chunkStart,
        chunkSize,
      } = data

      if (!sourceRaw || !targetRaw) {
        throw new Error('Raw CSV data is required for comparison.')
      }

      if (comparisonMode !== 'primary-key') {
        throw new Error('Chunked processing is only supported for primary-key mode.')
      }

      emitProgress(0, `Starting chunk ${chunkStart}...`)
      const results = diff_csv_primary_key_chunked(
        sourceRaw,
        targetRaw,
        keyColumns,
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        excludedColumns,
        hasHeaders !== false,
        chunkStart,
        chunkSize,
        (percent: number, message: string) => emitProgress(percent, message),
      )
      emitProgress(100, `Chunk ${chunkStart} complete`)

      ctx.postMessage({ requestId, type: 'chunk-complete', data: results })
    }
  } catch (error: any) {
    ctx.postMessage({
      requestId,
      type: 'error',
      data: { message: error.message, stack: error.stack },
    })
  }
}
