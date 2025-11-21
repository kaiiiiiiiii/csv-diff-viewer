import { expect, afterEach } from 'vitest'
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

// @ts-ignore
global.Worker = MockWorker
