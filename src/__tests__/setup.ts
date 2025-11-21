import { afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'

// Cleanup after each test case
afterEach(() => {
  cleanup()
})

// Mock Worker for tests
class MockWorker {
  url: string
  onmessage: ((e: MessageEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
  }

  postMessage(data: any) {
    // Mock implementation
  }

  terminate() {
    // Mock implementation
  }
}

// Set up global Worker mock for JSDOM environment
// JSDOM doesn't provide Worker by default
declare global {
  var Worker: typeof MockWorker
}

global.Worker = MockWorker as any
