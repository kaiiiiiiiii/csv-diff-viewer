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

  const compareChunked = useCallback(
    (
      sourceRaw: string,
      targetRaw: string,
      options: any,
      chunkStart: number,
      chunkSize: number,
      onProgress?: (percent: number, message: string) => void,
    ) => {
      return new Promise((resolve, reject) => {
        const id = requestIdCounterRef.current++
        const request: WorkerRequest = { id, resolve, reject, onProgress }
        requestMapRef.current.set(id, request)
        
        // Listen for chunk-complete instead of compare-complete
        const originalOnMessage = workerRef.current?.onmessage
        workerRef.current!.onmessage = (e: MessageEvent) => {
          const { requestId, type, data } = e.data
          const req = requestMapRef.current.get(requestId)

          if (!req) return

          if (type === 'progress') {
            req.onProgress?.(data.percent, data.message)
          } else if (type === 'error') {
            req.reject(new Error(data.message))
            requestMapRef.current.delete(requestId)
          } else if (type === 'chunk-complete') {
            req.resolve(data)
            requestMapRef.current.delete(requestId)
          } else if (type.endsWith('-complete')) {
            req.resolve(data)
            requestMapRef.current.delete(requestId)
          }
        }

        workerRef.current?.postMessage({
          requestId: id,
          type: 'compare-chunked',
          data: {
            sourceRaw,
            targetRaw,
            chunkStart,
            chunkSize,
            ...options,
          },
        })
      })
    },
    [],
  )

  return { parse, compare, compareChunked }
}
