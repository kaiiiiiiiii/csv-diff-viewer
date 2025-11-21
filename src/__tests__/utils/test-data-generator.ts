import { faker } from '@faker-js/faker'

export interface CsvGeneratorOptions {
  rows: number
  columns: number
  includeUnicode?: boolean
  includeSpecialChars?: boolean
  seed?: number
}

/**
 * Generate a large CSV dataset for testing
 */
export function generateLargeCsv(options: CsvGeneratorOptions): string {
  const { rows, columns, includeUnicode = false, includeSpecialChars = false, seed } = options

  if (seed !== undefined) {
    faker.seed(seed)
  }

  const headers: string[] = []
  for (let i = 0; i < columns; i++) {
    headers.push(`Column${i + 1}`)
  }

  const lines = [headers.join(',')]

  for (let row = 0; row < rows; row++) {
    const rowData: string[] = []
    for (let col = 0; col < columns; col++) {
      let value = ''
      
      if (col === 0) {
        // First column is always an ID
        value = `ID${row + 1}`
      } else if (includeUnicode && col % 5 === 0) {
        // Add unicode characters every 5th column
        value = faker.helpers.arrayElement([
          'Hello世界', '你好', 'Привет', '🎉🎊', 'Café', 'naïve'
        ])
      } else if (includeSpecialChars && col % 3 === 0) {
        // Add special characters every 3rd column
        value = faker.helpers.arrayElement([
          'value,with,commas',
          'value"with"quotes',
          'value\nwith\nnewlines',
          'value\twith\ttabs',
        ])
      } else {
        // Regular data
        value = faker.helpers.arrayElement([
          faker.person.fullName(),
          faker.internet.email(),
          faker.number.int({ min: 1, max: 1000 }).toString(),
          faker.lorem.word(),
          faker.datatype.boolean().toString(),
        ])
      }

      // Escape commas and quotes for CSV format
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        value = `"${value.replace(/"/g, '""')}"`
      }

      rowData.push(value)
    }
    lines.push(rowData.join(','))
  }

  return lines.join('\n')
}

/**
 * Generate a CSV with specific characteristics
 */
export function generateCsvWithCharacteristics(config: {
  rows: number
  singleColumn?: boolean
  unicodeOnly?: boolean
  emptyFields?: boolean
  nullFields?: boolean
}): string {
  const { rows, singleColumn = false, unicodeOnly = false, emptyFields = false, nullFields = false } = config

  const columns = singleColumn ? 1 : 3
  const headers = singleColumn ? ['Value'] : ['ID', 'Name', 'Data']
  const lines = [headers.join(',')]

  for (let i = 0; i < rows; i++) {
    if (singleColumn) {
      let value = unicodeOnly ? `测试${i}` : `Value${i}`
      if (emptyFields && i % 3 === 0) value = ''
      if (nullFields && i % 4 === 0) value = 'null'
      lines.push(value)
    } else {
      const id = `ID${i}`
      let name = unicodeOnly ? `用户${i}` : `Name${i}`
      let data = unicodeOnly ? `数据${i}` : `Data${i}`

      if (emptyFields && i % 3 === 0) name = ''
      if (nullFields && i % 4 === 0) data = 'null'

      lines.push([id, name, data].join(','))
    }
  }

  return lines.join('\n')
}

/**
 * Generate a CSV pair with known differences
 */
export function generateCsvPairWithDifferences(config: {
  baseRows: number
  addedRows: number
  removedRows: number
  modifiedRows: number
}): { source: string; target: string } {
  const { baseRows, addedRows, removedRows, modifiedRows } = config

  // Generate source CSV
  const sourceLines = ['ID,Name,Value']
  for (let i = 0; i < baseRows; i++) {
    sourceLines.push(`${i},Name${i},Value${i}`)
  }

  // Generate target CSV based on source with modifications
  const targetLines = ['ID,Name,Value']
  
  // Add unchanged rows (excluding rows to be removed and modified)
  const unchangedCount = baseRows - removedRows - modifiedRows
  for (let i = 0; i < unchangedCount; i++) {
    targetLines.push(`${i},Name${i},Value${i}`)
  }

  // Add modified rows
  for (let i = unchangedCount; i < unchangedCount + modifiedRows; i++) {
    targetLines.push(`${i},ModifiedName${i},ModifiedValue${i}`)
  }

  // Skip removed rows (they exist in source but not in target)

  // Add new rows
  for (let i = baseRows; i < baseRows + addedRows; i++) {
    targetLines.push(`${i},NewName${i},NewValue${i}`)
  }

  return {
    source: sourceLines.join('\n'),
    target: targetLines.join('\n'),
  }
}

/**
 * Measure memory usage of a CSV string
 */
export function estimateCsvMemorySize(csv: string): number {
  // Approximate memory size in bytes
  // JavaScript strings are UTF-16, so 2 bytes per character
  return csv.length * 2
}

/**
 * Measure memory usage in MB
 */
export function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024)
}
