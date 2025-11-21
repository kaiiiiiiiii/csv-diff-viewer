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

# Get file size - portable across macOS and Linux
SIZE_BYTES=$(stat -f%z "$WASM_DIR/$WASM_FILE" 2>/dev/null || stat -c%s "$WASM_DIR/$WASM_FILE")

# Use awk for portable arithmetic (no bc dependency)
SIZE_KB=$(awk "BEGIN {printf \"%.2f\", $SIZE_BYTES / 1024}")
SIZE_MB=$(awk "BEGIN {printf \"%.3f\", $SIZE_BYTES / 1048576}")

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
echo ""

# Show recent history
echo "Recent size history:"
tail -n 5 "$OUTPUT_FILE"
echo ""

# Check for size regression (more than 10% increase)
if [ -f "$OUTPUT_FILE" ]; then
    PREV_SIZE=$(tail -n 2 "$OUTPUT_FILE" | head -n 1 | awk -F'|' '{print $4}' | tr -d ' ')
    if [ ! -z "$PREV_SIZE" ] && [ "$PREV_SIZE" != "Size (KB)" ]; then
        INCREASE=$(awk "BEGIN {printf \"%.2f\", ($SIZE_KB - $PREV_SIZE) / $PREV_SIZE * 100}")
        INCREASE_ABS=$(awk "BEGIN {printf \"%.2f\", ($INCREASE < 0 ? -$INCREASE : $INCREASE)}")
        
        if awk "BEGIN {exit !($INCREASE > 10)}"; then
            echo -e "${YELLOW}⚠ Warning: WASM size increased by ${INCREASE}%${NC}"
        elif awk "BEGIN {exit !($INCREASE < -10)}"; then
            echo -e "${GREEN}✓ Great! WASM size decreased by ${INCREASE_ABS}%${NC}"
        fi
    fi
fi

# Show detailed analysis
echo "Detailed WASM module analysis:"
if command -v wasm-opt > /dev/null 2>&1; then
    echo "  Using wasm-opt for analysis..."
    wasm-opt "$WASM_DIR/$WASM_FILE" --print-function-sizes 2>/dev/null | head -n 20 || echo "  wasm-opt analysis failed"
else
    echo "  wasm-opt not found, skipping detailed analysis"
    echo "  Install with: npm install -g binaryen"
fi
