import React, { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface CsvInputProps {
  title: string;
  value?: string;
  onDataChange: (data: string, name: string) => void;
}

const LARGE_FILE_BYTES = 1024 * 1024; // 1MB
const TYPING_DEBOUNCE_MS = 275;

export function CsvInput({ title, value, onDataChange }: CsvInputProps) {
  const [text, setText] = useState(value || "");
  const [fileName, setFileName] = useState("");
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [pendingContent, setPendingContent] = useState<string | null>(null);

  // Last content handed to the parent, so its echo never overwrites newer typing
  const lastSentRef = useRef<string | undefined>(value);
  const pendingTextRef = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDataChangeRef = useRef(onDataChange);
  onDataChangeRef.current = onDataChange;

  const cancelPending = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  // Hand over any pending typed text now (blur precedes a Compare click)
  const flushPending = useCallback(() => {
    if (debounceRef.current === null) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = null;
    const data = pendingTextRef.current;
    lastSentRef.current = data;
    onDataChangeRef.current(data, "Manual Input");
  }, []);

  useEffect(() => flushPending, [flushPending]);

  useEffect(() => {
    if (value === undefined || value === lastSentRef.current) return;
    lastSentRef.current = value;
    cancelPending();
    // External reset/replace: large content stays behind the placeholder
    if (value.length > LARGE_FILE_BYTES) {
      setText("");
      setPendingContent(value);
      setIsLargeFile(true);
      setFileSize(value.length);
    } else {
      setText(value);
      setPendingContent(null);
      setIsLargeFile(false);
    }
  }, [value, cancelPending]);

  const emit = (data: string, name: string) => {
    lastSentRef.current = data;
    onDataChangeRef.current(data, name);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setFileSize(file.size);
      const isLarge = file.size > LARGE_FILE_BYTES;
      setIsLargeFile(isLarge);

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (!isLarge) {
          setText(content);
          setPendingContent(null);
        } else {
          setText("");
          setPendingContent(content);
        }
        cancelPending();
        emit(content, file.name);
      };
      reader.readAsText(file);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    setFileName("Manual Input");
    setIsLargeFile(false);
    setPendingContent(null);
    cancelPending();
    pendingTextRef.current = newText;
    if (newText.length > LARGE_FILE_BYTES) {
      // Large paste: hand over right away
      emit(newText, "Manual Input");
      return;
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      emit(newText, "Manual Input");
    }, TYPING_DEBOUNCE_MS);
  };

  const handleShowAnyway = () => {
    if (pendingContent !== null) {
      setText(pendingContent);
      setIsLargeFile(false);
      setPendingContent(null);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" className="relative w-full">
            <Upload className="mr-2 h-4 w-4" />
            {fileName || "Upload CSV File"}
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
            onBlur={flushPending}
            disabled={isLargeFile}
          />
        </div>
      </CardContent>
    </Card>
  );
}
