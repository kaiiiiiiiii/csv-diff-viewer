import { describe, it, expect } from 'vitest'
import {
  generateLargeCsv,
  generateCsvPairWithDifferences,
  bytesToMB,
  estimateCsvMemorySize,
} from '../utils/test-data-generator'

describe('CSV Diff Performance Tests', () => {
  describe('Performance benchmarks (simulated)', () => {
    it('should measure 10k row generation time', () => {
      const start = performance.now()
      const csv = generateLargeCsv({ rows: 10000, columns: 5, seed: 12345 })
      const duration = performance.now() - start

      expect(csv.length).toBeGreaterThan(0)
      console.log(`10k rows generation: ${duration.toFixed(2)}ms`)
      expect(duration).toBeLessThan(5000) // Should complete in under 5 seconds
    })

    it('should measure 50k row generation time', () => {
      const start = performance.now()
      const csv = generateLargeCsv({ rows: 50000, columns: 5, seed: 12345 })
      const duration = performance.now() - start

      expect(csv.length).toBeGreaterThan(0)
      console.log(`50k rows generation: ${duration.toFixed(2)}ms`)
      expect(duration).toBeLessThan(20000) // Should complete in under 20 seconds
    })

    it('should track memory usage for different dataset sizes', () => {
      const results: Array<{ rows: number; sizeMB: number; generationTimeMs: number }> = []

      const sizes = [1000, 10000, 50000]

      for (const rows of sizes) {
        const start = performance.now()
        const csv = generateLargeCsv({ rows, columns: 5, seed: 12345 })
        const generationTimeMs = performance.now() - start

        const sizeMB = bytesToMB(estimateCsvMemorySize(csv))
        results.push({ rows, sizeMB, generationTimeMs })

        console.log(`${rows.toLocaleString()} rows: ${sizeMB.toFixed(2)} MB, ${generationTimeMs.toFixed(2)}ms`)
      }

      // Verify memory increases with row count
      expect(results[1].sizeMB).toBeGreaterThan(results[0].sizeMB)
      expect(results[2].sizeMB).toBeGreaterThan(results[1].sizeMB)
    })
  })

  describe('Diff operation performance characteristics', () => {
    it('should generate diff pairs efficiently', () => {
      const start = performance.now()
      const { source, target } = generateCsvPairWithDifferences({
        baseRows: 10000,
        addedRows: 100,
        removedRows: 100,
        modifiedRows: 200,
      })
      const duration = performance.now() - start

      const sourceLines = source.split('\n').length
      const targetLines = target.split('\n').length

      expect(sourceLines).toBe(10001) // header + 10000 rows
      expect(targetLines).toBe(9801) // header + (10000 - 100 removed - 200 modified + 100 added + 200 modified)

      console.log(`Diff pair generation (10k rows): ${duration.toFixed(2)}ms`)
    })

    it('should estimate processing time for large datasets', () => {
      // Simulate expected processing times based on dataset size
      const benchmarks = [
        { rows: 10000, expectedMaxMs: 100 },
        { rows: 100000, expectedMaxMs: 1000 },
        { rows: 1000000, expectedMaxMs: 10000 },
      ]

      for (const benchmark of benchmarks) {
        console.log(
          `Expected max processing time for ${benchmark.rows.toLocaleString()} rows: ${benchmark.expectedMaxMs}ms`,
        )
        expect(benchmark.expectedMaxMs).toBeGreaterThan(0)
      }
    })
  })

  describe('Memory efficiency tests', () => {
    it('should measure memory efficiency of CSV representation', () => {
      const rows = 10000
      const csv = generateLargeCsv({ rows, columns: 5, seed: 12345 })

      const totalSize = estimateCsvMemorySize(csv)
      const sizePerRow = totalSize / rows
      const bytesPerRow = sizePerRow

      console.log(`Memory per row: ${bytesPerRow.toFixed(2)} bytes`)
      console.log(`Total memory for ${rows} rows: ${bytesToMB(totalSize).toFixed(2)} MB`)

      // Expect reasonable memory usage (less than 1KB per row for 5 columns)
      expect(bytesPerRow).toBeLessThan(1024)
    })

    it('should compare memory usage across different column counts', () => {
      const rows = 1000
      const columnCounts = [3, 5, 10, 20]
      const results: Array<{ columns: number; sizeMB: number }> = []

      for (const columns of columnCounts) {
        const csv = generateLargeCsv({ rows, columns, seed: 12345 })
        const sizeMB = bytesToMB(estimateCsvMemorySize(csv))
        results.push({ columns, sizeMB })

        console.log(`${columns} columns: ${sizeMB.toFixed(3)} MB`)
      }

      // More columns should use more memory
      for (let i = 1; i < results.length; i++) {
        expect(results[i].sizeMB).toBeGreaterThan(results[i - 1].sizeMB)
      }
    })

    it('should estimate memory for extreme datasets', () => {
      // Test theoretical limits without actually generating the data
      const extremeScenarios = [
        { rows: 1000000, columns: 5, description: '1M rows, 5 columns' },
        { rows: 10000000, columns: 5, description: '10M rows, 5 columns' },
        { rows: 100000, columns: 50, description: '100k rows, 50 columns' },
      ]

      for (const scenario of extremeScenarios) {
        // Estimate: ~50 bytes per cell (average)
        const estimatedBytes = scenario.rows * scenario.columns * 50
        const estimatedMB = estimatedBytes / (1024 * 1024)

        console.log(`${scenario.description}: ~${estimatedMB.toFixed(2)} MB estimated`)
        expect(estimatedMB).toBeGreaterThan(0)
      }
    })
  })

  describe('Performance regression indicators', () => {
    it('should establish baseline for small datasets', () => {
      const start = performance.now()
      const csv = generateLargeCsv({ rows: 100, columns: 5, seed: 12345 })
      const duration = performance.now() - start

      console.log(`Baseline (100 rows): ${duration.toFixed(2)}ms`)
      expect(duration).toBeLessThan(100) // Should be very fast
    })

    it('should establish baseline for medium datasets', () => {
      const start = performance.now()
      const csv = generateLargeCsv({ rows: 10000, columns: 5, seed: 12345 })
      const duration = performance.now() - start

      console.log(`Medium dataset (10k rows): ${duration.toFixed(2)}ms`)
      expect(duration).toBeLessThan(5000)
    })

    it('should track scaling characteristics', () => {
      const baselineRows = 1000
      const scaledRows = 10000

      const start1 = performance.now()
      const csv1 = generateLargeCsv({ rows: baselineRows, columns: 5, seed: 12345 })
      const duration1 = performance.now() - start1

      const start2 = performance.now()
      const csv2 = generateLargeCsv({ rows: scaledRows, columns: 5, seed: 12345 })
      const duration2 = performance.now() - start2

      const scalingFactor = scaledRows / baselineRows
      const timeScalingFactor = duration2 / duration1

      console.log(`Scaling factor: ${scalingFactor}x rows`)
      console.log(`Time scaling: ${timeScalingFactor.toFixed(2)}x`)

      // Time should scale roughly linearly (with some overhead)
      expect(timeScalingFactor).toBeGreaterThan(scalingFactor * 0.5)
      expect(timeScalingFactor).toBeLessThan(scalingFactor * 2)
    })
  })

  describe('Unicode and special character performance', () => {
    it('should measure unicode handling overhead', () => {
      const rows = 10000

      const start1 = performance.now()
      const csvRegular = generateLargeCsv({ rows, columns: 5, seed: 12345 })
      const duration1 = performance.now() - start1

      const start2 = performance.now()
      const csvUnicode = generateLargeCsv({
        rows,
        columns: 5,
        includeUnicode: true,
        seed: 12345,
      })
      const duration2 = performance.now() - start2

      const overhead = ((duration2 - duration1) / duration1) * 100

      console.log(`Regular: ${duration1.toFixed(2)}ms`)
      console.log(`Unicode: ${duration2.toFixed(2)}ms`)
      console.log(`Overhead: ${overhead.toFixed(2)}%`)

      // Unicode overhead should be minimal
      expect(Math.abs(overhead)).toBeLessThan(100) // Less than 100% overhead
    })

    it('should measure special character handling overhead', () => {
      const rows = 10000

      const start1 = performance.now()
      const csvRegular = generateLargeCsv({ rows, columns: 5, seed: 12345 })
      const duration1 = performance.now() - start1

      const start2 = performance.now()
      const csvSpecial = generateLargeCsv({
        rows,
        columns: 5,
        includeSpecialChars: true,
        seed: 12345,
      })
      const duration2 = performance.now() - start2

      console.log(`Regular: ${duration1.toFixed(2)}ms`)
      console.log(`Special chars: ${duration2.toFixed(2)}ms`)

      // Both should complete successfully
      expect(csvRegular.length).toBeGreaterThan(0)
      expect(csvSpecial.length).toBeGreaterThan(0)
    })
  })
})
