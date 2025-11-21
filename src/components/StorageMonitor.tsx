import { useEffect, useState } from 'react'
import { HardDrive, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { indexedDBManager } from '@/lib/indexeddb'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface StorageInfo {
  used: number
  available: number
  total: number
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

export function StorageMonitor() {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const updateStorageInfo = async () => {
    try {
      const used = await indexedDBManager.getStorageSize()
      const available = await indexedDBManager.getAvailableStorage()
      setStorageInfo({
        used,
        available,
        total: used + available,
      })
    } catch (error) {
      console.error('Failed to get storage info:', error)
    }
  }

  useEffect(() => {
    updateStorageInfo()
  }, [])

  const handleClearAll = async () => {
    setLoading(true)
    try {
      await indexedDBManager.clearAllDiffs()
      await updateStorageInfo()
    } catch (error) {
      console.error('Failed to clear storage:', error)
      alert('Failed to clear storage: ' + (error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!storageInfo) {
    return null
  }

  const usagePercent =
    storageInfo.total > 0 ? (storageInfo.used / storageInfo.total) * 100 : 0

  return (
    <Card className="bg-muted/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="h-4 w-4" />
          Storage Usage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Used:</span>
            <span className="font-medium">{formatBytes(storageInfo.used)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Available:</span>
            <span className="font-medium">
              {formatBytes(storageInfo.available)}
            </span>
          </div>
          <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300"
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            {usagePercent.toFixed(1)}% used
          </p>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={loading || storageInfo.used === 0}
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Clear All Stored Diffs
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear All Stored Diffs?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all diff results stored in
                IndexedDB. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleClearAll}>
                Clear All
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
