import { useCallback, useState } from 'react'
import { indexedDBManager } from '../lib/indexeddb'
import { useCsvWorker } from './useCsvWorker'
import type { DiffChunk, DiffMetadata } from '../lib/indexeddb';

export interface ChunkedDiffOptions {
  comparisonMode: 'primary-key' | 'content-match'
  keyColumns: Array<string>
  caseSensitive: boolean
  ignoreWhitespace: boolean
  ignoreEmptyVsNull: boolean
  excludedColumns: Array<string>
  hasHeaders: boolean
  chunkSize?: number // Default: 10000 rows per chunk
}

export interface ChunkedDiffProgress {
  currentChunk: number
  totalChunks: number
  percent: number
  message: string
  rowsProcessed: number
  totalRows: number
}

export function useChunkedDiff() {
  const { compareChunked } = useCsvWorker()
  const [isProcessing, setIsProcessing] = useState(false)
  const [diffId, setDiffId] = useState<string | null>(null)

  const startChunkedDiff = useCallback(
    async (
      sourceRaw: string,
      targetRaw: string,
      sourceHeaders: Array<string>,
      targetHeaders: Array<string>,
      options: ChunkedDiffOptions,
      onProgress?: (progress: ChunkedDiffProgress) => void,
    ): Promise<string> => {
      setIsProcessing(true)
      const newDiffId = `diff-${Date.now()}`
      setDiffId(newDiffId)

      try {
        // Estimate total rows (rough estimate based on newlines)
        const targetLines = targetRaw.split('\n').length - (options.hasHeaders ? 1 : 0)
        const chunkSize = options.chunkSize || 10000
        const totalChunks = Math.ceil(targetLines / chunkSize)

        // Save metadata
        const metadata: DiffMetadata = {
          id: newDiffId,
          totalChunks,
          source: { headers: sourceHeaders },
          target: { headers: targetHeaders },
          keyColumns: options.keyColumns,
          excludedColumns: options.excludedColumns,
          mode: options.comparisonMode,
          timestamp: Date.now(),
          completed: false,
        }
        await indexedDBManager.saveMetadata(metadata)

        // Process chunks
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const chunkStart = chunkIndex * chunkSize
          
          const chunkProgress: ChunkedDiffProgress = {
            currentChunk: chunkIndex + 1,
            totalChunks,
            percent: (chunkIndex / totalChunks) * 100,
            message: `Processing chunk ${chunkIndex + 1} of ${totalChunks}...`,
            rowsProcessed: chunkStart,
            totalRows: targetLines,
          }
          onProgress?.(chunkProgress)

          // Process chunk with WASM
          const chunkResult = await compareChunked(
            sourceRaw,
            targetRaw,
            options,
            chunkStart,
            chunkSize,
            (percent, message) => {
              const overallPercent = 
                (chunkIndex / totalChunks) * 100 + (percent / 100) * (100 / totalChunks)
              onProgress?.({
                ...chunkProgress,
                percent: overallPercent,
                message,
              })
            },
          )

          // Save chunk to IndexedDB
          const chunk: DiffChunk = {
            id: `${newDiffId}-chunk-${chunkIndex}`,
            chunkIndex,
            diffId: newDiffId,
            data: {
              added: chunkResult.added || [],
              removed: chunkResult.removed || [],
              modified: chunkResult.modified || [],
              unchanged: chunkResult.unchanged || [],
            },
            timestamp: Date.now(),
          }
          await indexedDBManager.saveChunk(chunk)

          // Yield to browser to prevent UI freeze
          await new Promise((resolve) => {
            if ('scheduler' in window && 'postTask' in (window as any).scheduler) {
              ;(window as any).scheduler.postTask(resolve)
            } else {
              queueMicrotask(resolve)
            }
          })
        }

        // Mark as completed
        metadata.completed = true
        await indexedDBManager.saveMetadata(metadata)

        onProgress?.({
          currentChunk: totalChunks,
          totalChunks,
          percent: 100,
          message: 'Diff complete!',
          rowsProcessed: targetLines,
          totalRows: targetLines,
        })

        setIsProcessing(false)
        return newDiffId
      } catch (error) {
        setIsProcessing(false)
        throw error
      }
    },
    [compareChunked],
  )

  const loadDiffResults = useCallback(async (id: string) => {
    const metadata = await indexedDBManager.getMetadata(id)
    if (!metadata) {
      throw new Error('Diff not found')
    }

    const chunks = await indexedDBManager.getChunksByDiffId(id)
    
    // Merge chunks
    const result = {
      added: [] as Array<any>,
      removed: [] as Array<any>,
      modified: [] as Array<any>,
      unchanged: [] as Array<any>,
      source: metadata.source,
      target: metadata.target,
      keyColumns: metadata.keyColumns,
      excludedColumns: metadata.excludedColumns,
      mode: metadata.mode,
    }

    for (const chunk of chunks) {
      result.added.push(...(chunk.data.added || []))
      result.removed.push(...(chunk.data.removed || []))
      result.modified.push(...(chunk.data.modified || []))
      result.unchanged.push(...(chunk.data.unchanged || []))
    }

    return result
  }, [])

  const clearDiff = useCallback(async (id: string) => {
    await indexedDBManager.clearDiff(id)
    if (id === diffId) {
      setDiffId(null)
    }
  }, [diffId])

  const getStorageInfo = useCallback(async () => {
    const used = await indexedDBManager.getStorageSize()
    const available = await indexedDBManager.getAvailableStorage()
    return { used, available, total: used + available }
  }, [])

  return {
    startChunkedDiff,
    loadDiffResults,
    clearDiff,
    getStorageInfo,
    isProcessing,
    diffId,
  }
}
