import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'

interface ConfigPanelProps {
  mode: 'primary-key' | 'content-match'
  setMode: (mode: 'primary-key' | 'content-match') => void
  keyColumns: Array<string>
  setKeyColumns: (keys: Array<string>) => void
  excludedColumns: Array<string>
  setExcludedColumns: (cols: Array<string>) => void
  hasHeaders: boolean
  setHasHeaders: (val: boolean) => void
  ignoreWhitespace: boolean
  setIgnoreWhitespace: (val: boolean) => void
  caseSensitive: boolean
  setCaseSensitive: (val: boolean) => void
  ignoreEmptyVsNull: boolean
  setIgnoreEmptyVsNull: (val: boolean) => void
  availableColumns: Array<string>
  useChunkedMode?: boolean
  setUseChunkedMode?: (val: boolean) => void
  chunkSize?: number
  setChunkSize?: (val: number) => void
}

export function ConfigPanel({
  mode,
  setMode,
  keyColumns,
  setKeyColumns,
  excludedColumns,
  setExcludedColumns,
  hasHeaders,
  setHasHeaders,
  ignoreWhitespace,
  setIgnoreWhitespace,
  caseSensitive,
  setCaseSensitive,
  ignoreEmptyVsNull,
  setIgnoreEmptyVsNull,
  availableColumns,
  useChunkedMode = false,
  setUseChunkedMode,
  chunkSize = 10000,
  setChunkSize,
}: ConfigPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">Comparison Mode</label>
          <Select value={mode} onValueChange={(v: any) => setMode(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="content-match">Content Match</SelectItem>
              <SelectItem value="primary-key">Primary Key</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === 'primary-key' && (
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Key Columns (comma separated)
            </label>
            <Input
              value={keyColumns.join(', ')}
              onChange={(e) =>
                setKeyColumns(e.target.value.split(',').map((s) => s.trim()))
              }
              placeholder="e.g. ID, Email"
            />
            {availableColumns.length !== 0 && (
              <p className="text-xs text-muted-foreground">
                Available: {availableColumns.join(', ')}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Excluded Columns (comma separated)
          </label>
          <Input
            value={excludedColumns.join(', ')}
            onChange={(e) =>
              setExcludedColumns(e.target.value.split(',').map((s) => s.trim()))
            }
            placeholder="e.g. CreatedAt, UpdatedAt"
          />
          {availableColumns.length !== 0 && (
            <p className="text-xs text-muted-foreground">
              Available: {availableColumns.join(', ')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Has Headers</label>
          <Switch checked={hasHeaders} onCheckedChange={setHasHeaders} />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Case Sensitive</label>
          <Switch checked={caseSensitive} onCheckedChange={setCaseSensitive} />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Ignore Whitespace</label>
          <Switch
            checked={ignoreWhitespace}
            onCheckedChange={setIgnoreWhitespace}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Ignore Empty vs Null</label>
          <Switch
            checked={ignoreEmptyVsNull}
            onCheckedChange={setIgnoreEmptyVsNull}
          />
        </div>

        {mode === 'primary-key' && setUseChunkedMode && (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <label className="text-sm font-medium">Chunked Processing</label>
                <p className="text-xs text-muted-foreground">
                  For large datasets (1M+ rows). Stores results in IndexedDB.
                </p>
              </div>
              <Switch
                checked={useChunkedMode}
                onCheckedChange={setUseChunkedMode}
              />
            </div>

            {useChunkedMode && setChunkSize && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Chunk Size (rows per chunk)
                </label>
                <Input
                  type="number"
                  value={chunkSize}
                  onChange={(e) => setChunkSize(parseInt(e.target.value, 10) || 10000)}
                  min={1000}
                  max={100000}
                  step={1000}
                />
                <p className="text-xs text-muted-foreground">
                  Default: 10,000 rows. Lower for less memory, higher for faster processing.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
