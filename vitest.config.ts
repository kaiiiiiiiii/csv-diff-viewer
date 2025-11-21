import path from 'node:path'
import { defineConfig } from 'vitest/config'
import wasm from 'vite-plugin-wasm'

export default defineConfig({
  plugins: [wasm()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/__tests__/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.config.*',
        '**/dist/',
        '**/pkg/',
        '**/*.d.ts',
      ],
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
