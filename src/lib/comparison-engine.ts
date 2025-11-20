export interface DiffResult {
  added: Array<any>
  removed: Array<any>
  modified: Array<any>
  unchanged: Array<any>
  source: { headers: Array<string>; rows: Array<any> }
  target: { headers: Array<string>; rows: Array<any> }
  keyColumns: Array<string>
  excludedColumns: Array<string>
  mode: 'primary-key' | 'content-match'
}

export interface DiffChange {
  added: boolean
  removed: boolean
  value: string
}

export type ProgressCallback = (percent: number, message: string) => void
