import { Card, CardContent } from '@/components/ui/card'

interface DiffStatsProps {
  added: number
  removed: number
  modified: number
  unchanged: number
}

export function DiffStats({
  added,
  removed,
  modified,
  unchanged,
}: DiffStatsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold text-green-600">{added}</div>
          <p className="text-xs text-muted-foreground">Rows Added</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold text-red-600">{removed}</div>
          <p className="text-xs text-muted-foreground">Rows Removed</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold text-yellow-600">{modified}</div>
          <p className="text-xs text-muted-foreground">Rows Modified</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold text-gray-600">{unchanged}</div>
          <p className="text-xs text-muted-foreground">Rows Unchanged</p>
        </CardContent>
      </Card>
    </div>
  )
}
