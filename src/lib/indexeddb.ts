/**
 * IndexedDB wrapper for storing large CSV diff results
 * Allows chunked storage and retrieval to avoid memory overflow
 */

const DB_NAME = 'csv-diff-viewer'
const DB_VERSION = 1
const STORE_NAME = 'diff-results'

export interface DiffChunk {
  id: string // Unique identifier for the chunk
  chunkIndex: number // Order of the chunk
  diffId: string // ID of the diff session
  data: {
    added?: Array<any>
    removed?: Array<any>
    modified?: Array<any>
    unchanged?: Array<any>
  }
  timestamp: number
}

export interface DiffMetadata {
  id: string
  totalChunks: number
  source: { headers: Array<string> }
  target: { headers: Array<string> }
  keyColumns: Array<string>
  excludedColumns: Array<string>
  mode: 'primary-key' | 'content-match'
  timestamp: number
  completed: boolean
}

class IndexedDBManager {
  private db: IDBDatabase | null = null
  private dbPromise: Promise<IDBDatabase> | null = null

  async init(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db
    }

    if (this.dbPromise) {
      return this.dbPromise
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'))
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Store for diff chunks
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('diffId', 'diffId', { unique: false })
          store.createIndex('chunkIndex', 'chunkIndex', { unique: false })
        }

        // Store for metadata
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'id' })
        }
      }
    })

    return this.dbPromise
  }

  async saveChunk(chunk: DiffChunk): Promise<void> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(chunk)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error('Failed to save chunk'))
    })
  }

  async saveMetadata(metadata: DiffMetadata): Promise<void> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['metadata'], 'readwrite')
      const store = transaction.objectStore('metadata')
      const request = store.put(metadata)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error('Failed to save metadata'))
    })
  }

  async getMetadata(diffId: string): Promise<DiffMetadata | null> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['metadata'], 'readonly')
      const store = transaction.objectStore('metadata')
      const request = store.get(diffId)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(new Error('Failed to get metadata'))
    })
  }

  async getChunk(chunkId: string): Promise<DiffChunk | null> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(chunkId)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(new Error('Failed to get chunk'))
    })
  }

  async getChunksByDiffId(diffId: string): Promise<Array<DiffChunk>> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('diffId')
      const request = index.getAll(IDBKeyRange.only(diffId))

      request.onsuccess = () => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const chunks = request.result ?? []
        // Sort by chunk index
        chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)
        resolve(chunks)
      }
      request.onerror = () => reject(new Error('Failed to get chunks'))
    })
  }

  async clearDiff(diffId: string): Promise<void> {
    const db = await this.init()
    const chunks = await this.getChunksByDiffId(diffId)

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, 'metadata'], 'readwrite')

      // Delete all chunks
      const chunkStore = transaction.objectStore(STORE_NAME)
      for (const chunk of chunks) {
        chunkStore.delete(chunk.id)
      }

      // Delete metadata
      const metadataStore = transaction.objectStore('metadata')
      metadataStore.delete(diffId)

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('Failed to clear diff'))
    })
  }

  async clearAllDiffs(): Promise<void> {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, 'metadata'], 'readwrite')

      transaction.objectStore(STORE_NAME).clear()
      transaction.objectStore('metadata').clear()

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('Failed to clear all diffs'))
    })
  }

  async getStorageSize(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!navigator.storage?.estimate) {
      return 0
    }
    const estimate = await navigator.storage.estimate()
    return estimate.usage ?? 0
  }

  async getAvailableStorage(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!navigator.storage?.estimate) {
      return 0
    }
    const estimate = await navigator.storage.estimate()
    return (estimate.quota ?? 0) - (estimate.usage ?? 0)
  }
}

export const indexedDBManager = new IndexedDBManager()
