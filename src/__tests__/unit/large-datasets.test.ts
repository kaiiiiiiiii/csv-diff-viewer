import { beforeAll, describe, expect, it } from 'vitest'
import {
  bytesToMB,
  estimateCsvMemorySize,
  generateCsvWithCharacteristics,
  generateLargeCsv,
} from '../utils/test-data-generator'

describe('Large Dataset Tests', () => {
  describe('10k+ rows CSV generation', () => {
    it('should generate CSV with 10k rows', () => {
      const csv = generateLargeCsv({ rows: 10000, columns: 5, seed: 12345 })
      const lines = csv.split('\n')

      // Should have header + 10k rows
      expect(lines.length).toBe(10001)

      // Check first line is header
      expect(lines[0]).toContain('Column1')

      // Check last row exists
      expect(lines[10000]).toBeTruthy()
      expect(lines[10000]).toContain('ID10000')
    })

    it('should generate CSV with 50k rows', () => {
      const csv = generateLargeCsv({ rows: 50000, columns: 3, seed: 12345 })
      const lines = csv.split('\n')

      expect(lines.length).toBe(50001)

      // Verify memory estimation
      const memorySize = estimateCsvMemorySize(csv)
      const sizeMB = bytesToMB(memorySize)

      console.log(`50k rows CSV: ${sizeMB.toFixed(2)} MB`)
      expect(sizeMB).toBeGreaterThan(0)
    })

    it('should generate CSV with 100k rows', () => {
      const csv = generateLargeCsv({ rows: 100000, columns: 5, seed: 12345 })
      const lines = csv.split('\n')

      expect(lines.length).toBe(100001)

      const memorySize = estimateCsvMemorySize(csv)
      const sizeMB = bytesToMB(memorySize)

      console.log(`100k rows CSV: ${sizeMB.toFixed(2)} MB`)
      expect(sizeMB).toBeGreaterThan(0)
    }, 15000)
  })

  describe('Unicode and special character handling', () => {
    it('should handle Unicode characters in CSV', () => {
      // Use more columns to ensure unicode is included (col % 5 === 0, so we need at least col 5)
      const csv = generateLargeCsv({
        rows: 1000,
        columns: 10,
        includeUnicode: true,
        seed: 12345,
      })

      // Check for unicode presence - unicode is added at column indexes 5, 10, etc (col % 5 === 0, col > 0)
      expect(csv).toMatch(/世界|你好|Привет|🎉/)

      const lines = csv.split('\n')
      expect(lines.length).toBe(1001)
    })

    it('should handle special characters (commas, quotes, newlines)', () => {
      const csv = generateLargeCsv({
        rows: 1000,
        columns: 5,
        includeSpecialChars: true,
        seed: 12345,
      })

      // Should have quoted fields for special chars
      expect(csv).toMatch(/"[^"]*,[^"]*"/)

      // Note: split('\n') will not work correctly for CSVs with newlines inside quoted fields
      // Just verify the CSV is generated
      expect(csv.length).toBeGreaterThan(0)
      expect(csv).toContain('Column1')
    })

    it('should handle mixed unicode and special characters', () => {
      const csv = generateLargeCsv({
        rows: 500,
        columns: 10,
        includeUnicode: true,
        includeSpecialChars: true,
        seed: 12345,
      })

      expect(csv.length).toBeGreaterThan(0)

      // Note: CSV with special chars may have embedded newlines in quoted fields
      // Just verify content is present
      expect(csv).toContain('Column1')
      expect(csv).toContain('ID500')
    })

    it('should generate unicode-only CSV', () => {
      const csv = generateCsvWithCharacteristics({
        rows: 100,
        unicodeOnly: true,
      })

      expect(csv).toMatch(/测试|用户|数据/)

      const lines = csv.split('\n')
      expect(lines.length).toBe(101) // header + 100 rows
    })
  })

  describe('Boundary conditions', () => {
    it('should handle 1-row CSV', () => {
      const csv = generateLargeCsv({ rows: 1, columns: 5, seed: 12345 })
      const lines = csv.split('\n')

      // Header + 1 data row
      expect(lines.length).toBe(2)
      expect(lines[0]).toContain('Column1')
      expect(lines[1]).toContain('ID1')
    })

    it('should handle single column CSV', () => {
      const csv = generateCsvWithCharacteristics({
        rows: 100,
        singleColumn: true,
      })

      const lines = csv.split('\n')
      expect(lines.length).toBe(101)

      // Each line should be a single value (no commas)
      const firstDataRow = lines[1]
      expect(firstDataRow.split(',').length).toBe(1)
    })

    it('should handle 1-row single-column CSV', () => {
      const csv = generateCsvWithCharacteristics({
        rows: 1,
        singleColumn: true,
      })

      const lines = csv.split('\n')
      expect(lines.length).toBe(2) // header + 1 row
    })

    it('should handle empty fields', () => {
      const csv = generateCsvWithCharacteristics({
        rows: 100,
        emptyFields: true,
      })

      // Should have some empty fields
      expect(csv).toMatch(/,,|,\n/)

      const lines = csv.split('\n')
      expect(lines.length).toBe(101)
    })

    it('should handle null fields', () => {
      const csv = generateCsvWithCharacteristics({
        rows: 100,
        nullFields: true,
      })

      // Should have 'null' string in some fields
      expect(csv).toContain('null')

      const lines = csv.split('\n')
      expect(lines.length).toBe(101)
    })
  })

  describe('Memory characteristics', () => {
    it('should estimate memory for different sizes', () => {
      const sizes = [100, 1000, 10000, 50000]
      const results: Array<{ rows: number; sizeMB: number }> = []

      for (const size of sizes) {
        const csv = generateLargeCsv({ rows: size, columns: 5, seed: 12345 })
        const memorySize = estimateCsvMemorySize(csv)
        const sizeMB = bytesToMB(memorySize)

        results.push({ rows: size, sizeMB })
        console.log(`${size} rows: ${sizeMB.toFixed(2)} MB`)
      }

      // Memory should increase with row count
      for (let i = 1; i < results.length; i++) {
        expect(results[i].sizeMB).toBeGreaterThan(results[i - 1].sizeMB)
      }
    })

    it('should track memory growth rate', () => {
      const csv1k = generateLargeCsv({ rows: 1000, columns: 5, seed: 12345 })
      const csv10k = generateLargeCsv({ rows: 10000, columns: 5, seed: 12345 })

      const size1k = bytesToMB(estimateCsvMemorySize(csv1k))
      const size10k = bytesToMB(estimateCsvMemorySize(csv10k))

      // 10k should be roughly 10x larger than 1k
      const ratio = size10k / size1k
      expect(ratio).toBeGreaterThan(8)
      expect(ratio).toBeLessThan(12)

      console.log(`Memory growth ratio (10k/1k): ${ratio.toFixed(2)}x`)
    })
  })
})
