import { useCallback, useEffect, useRef } from 'react'
import CsvWorker from '../workers/csv.worker?worker'

interface WorkerRequest {
  id: number
  resolve: (data: any) => void
  reject: (error: any) => void
  onProgress?: (percent: number, message: string) => void
}

export function useCsvWorker() {
  const workerRef = useRef<Worker | null>(null)
  const requestMapRef = useRef<Map<number, WorkerRequest>>(new Map())
  const requestIdCounterRef = useRef(1)

  useEffect(() => {
    const worker = new CsvWorker()
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent) => {
      const { requestId, type, data } = e.data
      const request = requestMapRef.current.get(requestId)

      if (!request) return

      if (type === 'progress') {
        request.onProgress?.(data.percent, data.message)
      } else if (type === 'error') {
        request.reject(new Error(data.message))
        requestMapRef.current.delete(requestId)
      } else if (type.endsWith('-complete')) {
        request.resolve(data)
        requestMapRef.current.delete(requestId)
      }
    }

    return () => {
      worker.terminate()
    }
  }, [])

  const parse = useCallback(
    (csvText: string, name: string, hasHeaders: boolean) => {
      return new Promise((resolve, reject) => {
        const id = requestIdCounterRef.current++
        requestMapRef.current.set(id, { id, resolve, reject })
        workerRef.current?.postMessage({
          requestId: id,
          type: 'parse',
          data: { csvText, name, hasHeaders },
        })
      })
    },
    [],
  )

  const compare = useCallback(
    (
      source: any,
      target: any,
      options: any,
      onProgress?: (percent: number, message: string) => void,
    ) => {
      return new Promise((resolve, reject) => {
        const id = requestIdCounterRef.current++
        requestMapRef.current.set(id, { id, resolve, reject, onProgress })
        workerRef.current?.postMessage({
          requestId: id,
          type: 'compare',
          data: {
            source,
            target,
            ...options,
          },
        })
      })
    },
    [],
  )

  const initDiffer = useCallback(
    (sourceRaw: string, targetRaw: string, options: any) => {
      return new Promise((resolve, reject) => {
        const id = requestIdCounterRef.current++
        requestMapRef.current.set(id, { id, resolve, reject })
        workerRef.current?.postMessage({
          requestId: id,
          type: 'init-differ',
          data: {
            sourceRaw,
            targetRaw,
            ...options,
          },
        })
      })
    },
    [],
  )

  const diffChunk = useCallback(
    (
      chunkStart: number,
      chunkSize: number,
      onProgress?: (percent: number, message: string) => void,
    ) => {
      return new Promise((resolve, reject) => {
        const id = requestIdCounterRef.current++
        requestMapRef.current.set(id, { id, resolve, reject, onProgress })
        workerRef.current?.postMessage({
          requestId: id,
          type: 'diff-chunk',
          data: {
            chunkStart,
            chunkSize,
          },
        })
      })
    },
    [],
  )

  const cleanupDiffer = useCallback(() => {
    return new Promise((resolve, reject) => {
      const id = requestIdCounterRef.current++
      requestMapRef.current.set(id, { id, resolve, reject })
      workerRef.current?.postMessage({
        requestId: id,
        type: 'cleanup-differ',
        data: {},
      })
    })
  }, [])

  return { parse, compare, initDiffer, diffChunk, cleanupDiffer }
}
