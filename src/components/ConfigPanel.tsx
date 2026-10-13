import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

interface ConfigPanelProps {
  mode: "primary-key" | "content-match";
  setMode: (mode: "primary-key" | "content-match") => void;
  keyColumns: Array<string>;
  setKeyColumns: (keys: Array<string>) => void;
  excludedColumns: Array<string>;
  setExcludedColumns: (cols: Array<string>) => void;
  hasHeaders: boolean;
  setHasHeaders: (val: boolean) => void;
  ignoreWhitespace: boolean;
  setIgnoreWhitespace: (val: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (val: boolean) => void;
  ignoreEmptyVsNull: boolean;
  setIgnoreEmptyVsNull: (val: boolean) => void;
  availableColumns: Array<string>;
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
}: ConfigPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="config-mode" className="text-sm font-medium">
            Comparison Mode
          </label>
          <Select value={mode} onValueChange={(v: any) => setMode(v)}>
            <SelectTrigger id="config-mode">
              <SelectValue placeholder="Select mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="content-match">Content Match</SelectItem>
              <SelectItem value="primary-key">Primary Key</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === "primary-key" && (
          <div className="space-y-2">
            <label htmlFor="config-key-columns" className="text-sm font-medium">
              Key Columns (comma separated)
            </label>
            <Input
              id="config-key-columns"
              value={keyColumns.join(", ")}
              onChange={(e) =>
                setKeyColumns(e.target.value.split(",").map((s) => s.trim()))
              }
              placeholder="e.g. ID, Email"
            />
            {availableColumns.length !== 0 && (
              <p className="text-xs text-muted-foreground">
                Available: {availableColumns.join(", ")}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label
            htmlFor="config-excluded-columns"
            className="text-sm font-medium"
          >
            Excluded Columns (comma separated)
          </label>
          <Input
            id="config-excluded-columns"
            value={excludedColumns.join(", ")}
            onChange={(e) =>
              setExcludedColumns(e.target.value.split(",").map((s) => s.trim()))
            }
            placeholder="e.g. CreatedAt, UpdatedAt"
          />
          {availableColumns.length !== 0 && (
            <p className="text-xs text-muted-foreground">
              Available: {availableColumns.join(", ")}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <label htmlFor="config-has-headers" className="text-sm font-medium">
            Has Headers
          </label>
          <Switch
            id="config-has-headers"
            checked={hasHeaders}
            onCheckedChange={setHasHeaders}
          />
        </div>

        <div className="flex items-center justify-between">
          <label
            htmlFor="config-case-sensitive"
            className="text-sm font-medium"
          >
            Case Sensitive
          </label>
          <Switch
            id="config-case-sensitive"
            checked={caseSensitive}
            onCheckedChange={setCaseSensitive}
          />
        </div>

        <div className="flex items-center justify-between">
          <label
            htmlFor="config-ignore-whitespace"
            className="text-sm font-medium"
          >
            Ignore Whitespace
          </label>
          <Switch
            id="config-ignore-whitespace"
            checked={ignoreWhitespace}
            onCheckedChange={setIgnoreWhitespace}
          />
        </div>

        <div className="flex items-center justify-between">
          <label
            htmlFor="config-ignore-empty-null"
            className="text-sm font-medium"
          >
            Ignore Empty vs Null
          </label>
          <Switch
            id="config-ignore-empty-null"
            checked={ignoreEmptyVsNull}
            onCheckedChange={setIgnoreEmptyVsNull}
          />
        </div>
      </CardContent>
    </Card>
  );
}
