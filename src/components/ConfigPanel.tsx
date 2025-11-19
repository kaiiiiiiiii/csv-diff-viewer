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
  keyColumns: string[]
  setKeyColumns: (keys: string[]) => void
  excludedColumns: string[]
  setExcludedColumns: (cols: string[]) => void
  hasHeaders: boolean
  setHasHeaders: (val: boolean) => void
  ignoreWhitespace: boolean
  setIgnoreWhitespace: (val: boolean) => void
  caseSensitive: boolean
  setCaseSensitive: (val: boolean) => void
  availableColumns: string[]
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
  availableColumns,
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
              <SelectItem value="primary-key">
                Primary Key (Best for DB dumps)
              </SelectItem>
              <SelectItem value="content-match">
                Content Match (Best for small lists)
              </SelectItem>
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
                setKeyColumns(
                  e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              placeholder="e.g. ID, Email"
            />
            <p className="text-xs text-muted-foreground">
              Available: {availableColumns.join(', ')}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Excluded Columns (comma separated)
          </label>
          <Input
            value={excludedColumns.join(', ')}
            onChange={(e) =>
              setExcludedColumns(
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            placeholder="e.g. CreatedAt, UpdatedAt"
          />
          <p className="text-xs text-muted-foreground">
            Available: {availableColumns.join(', ')}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Has Headers</label>
          <Switch checked={hasHeaders} onCheckedChange={setHasHeaders} />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Ignore Whitespace</label>
          <Switch
            checked={ignoreWhitespace}
            onCheckedChange={setIgnoreWhitespace}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Case Sensitive</label>
          <Switch checked={caseSensitive} onCheckedChange={setCaseSensitive} />
        </div>
      </CardContent>
    </Card>
  )
}
