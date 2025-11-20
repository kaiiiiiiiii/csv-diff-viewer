import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Upload } from 'lucide-react'

interface CsvInputProps {
  title: string
  value?: string
  onDataChange: (data: string, name: string) => void
}

export function CsvInput({ title, value, onDataChange }: CsvInputProps) {
  const [text, setText] = useState(value || '')
  const [fileName, setFileName] = useState('')
  const [isLargeFile, setIsLargeFile] = useState(false)
  const [fileSize, setFileSize] = useState(0)
  const [pendingContent, setPendingContent] = useState<string | null>(null)

  React.useEffect(() => {
    if (value !== undefined) {
      setText(value)
    }
  }, [value])

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFileName(file.name)
      setFileSize(file.size)
      const isLarge = file.size > 1024 * 1024 // 1MB
      setIsLargeFile(isLarge)

      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        if (!isLarge) {
          setText(content)
          setPendingContent(null)
        } else {
          setText('')
          setPendingContent(content)
        }
        onDataChange(content, file.name)
      }
      reader.readAsText(file)
    }
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setText(newText)
    setFileName('Manual Input')
    setIsLargeFile(false)
    setPendingContent(null)
    onDataChange(newText, 'Manual Input')
  }

  const handleShowAnyway = () => {
    if (pendingContent !== null) {
      setText(pendingContent)
      setIsLargeFile(false)
      setPendingContent(null)
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" className="relative w-full">
            <Upload className="mr-2 h-4 w-4" />
            {fileName || 'Upload CSV File'}
            <input
              type="file"
              accept=".csv"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleFileChange}
            />
          </Button>
        </div>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or paste text
            </span>
          </div>
        </div>
        <div className="relative">
          {isLargeFile && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md border bg-background/80 backdrop-blur-sm p-4 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                File is too large to display ({formatFileSize(fileSize)}).
                Content is loaded in background.
              </p>
              <Button variant="secondary" size="sm" onClick={handleShowAnyway}>
                Show anyway
              </Button>
            </div>
          )}
          <Textarea
            placeholder="Paste CSV content here..."
            className="min-h-[200px] font-mono text-sm"
            value={text}
            onChange={handleTextChange}
            disabled={isLargeFile}
          />
        </div>
      </CardContent>
    </Card>
  )
}
