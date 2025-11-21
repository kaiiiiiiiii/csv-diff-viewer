#!/bin/bash

# Track WASM binary size
# Usage: ./scripts/track-wasm-size.sh

set -e

WASM_DIR="src-wasm/pkg"
WASM_FILE="csv_diff_wasm_bg.wasm"
OUTPUT_FILE="WASM_SIZE_HISTORY.md"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Building WASM module..."
cd src-wasm
wasm-pack build --target web --release
cd ..

if [ ! -f "$WASM_DIR/$WASM_FILE" ]; then
    echo "Error: WASM file not found at $WASM_DIR/$WASM_FILE"
    exit 1
fi

# Get file size
SIZE_BYTES=$(stat -f%z "$WASM_DIR/$WASM_FILE" 2>/dev/null || stat -c%s "$WASM_DIR/$WASM_FILE")
SIZE_KB=$(echo "scale=2; $SIZE_BYTES / 1024" | bc)
SIZE_MB=$(echo "scale=3; $SIZE_BYTES / 1048576" | bc)

# Get timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo -e "${GREEN}✓${NC} WASM binary size: ${YELLOW}${SIZE_KB} KB${NC} (${SIZE_MB} MB)"
echo ""

# Create or update history file
if [ ! -f "$OUTPUT_FILE" ]; then
    cat > "$OUTPUT_FILE" << EOFINNER
# WASM Binary Size History

Track changes in WASM binary size over time to detect regressions.

| Date | Commit | Size (KB) | Size (MB) | Notes |
|------|--------|-----------|-----------|-------|
EOFINNER
fi

# Append new entry
echo "| $TIMESTAMP | $COMMIT | $SIZE_KB | $SIZE_MB | Manual build |" >> "$OUTPUT_FILE"

echo "Size recorded in $OUTPUT_FILE"
