#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
PROFILE="release"
for arg in "$@"; do
  case $arg in
    --dev|--debug)
      PROFILE="dev"
      shift
      ;;
    --release)
      PROFILE="release"
      shift
      ;;
  esac
done

echo -e "${GREEN}=== Building WASM with Rayon/Threading Support ===${NC}"
echo "Profile: $PROFILE"
echo "Target: wasm32-unknown-unknown"
echo ""

# Set required flags for atomics/threading and shared memory imports
# These flags are required when building wasm-bindgen + wasm-bindgen-rayon
# so that the wasm module exports/imports a shared memory that can be
# cloned/transferred across workers.
export RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--import-memory -C link-arg=--shared-memory -C link-arg=--max-memory=1073741824 -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base"

# Clean previous build artifacts
echo -e "${YELLOW}Cleaning previous builds...${NC}"
cargo clean

# Step 1: Build with cargo
echo -e "${YELLOW}Step 1: Building WASM module with cargo...${NC}"
cargo +nightly build \
  --lib \
  --target wasm32-unknown-unknown \
  --profile $PROFILE \
  -Z build-std=std,panic_abort

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Cargo build failed${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Cargo build successful${NC}"
echo ""

# Determine output directory based on profile
if [ "$PROFILE" = "dev" ]; then
  WASM_FILE="target/wasm32-unknown-unknown/debug/csv_diff_wasm.wasm"
else
  WASM_FILE="target/wasm32-unknown-unknown/release/csv_diff_wasm.wasm"
fi

# Check if WASM file exists
if [ ! -f "$WASM_FILE" ]; then
  echo -e "${RED}❌ WASM file not found: $WASM_FILE${NC}"
  exit 1
fi

echo "WASM file: $WASM_FILE"
echo "Size: $(du -h $WASM_FILE | cut -f1)"
echo ""

# Step 2: Run wasm-bindgen
echo -e "${YELLOW}Step 2: Running wasm-bindgen...${NC}"

# Create pkg directory
mkdir -p pkg

wasm-bindgen \
  "$WASM_FILE" \
  --out-dir pkg \
  --target web \
  --omit-default-module-path

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ wasm-bindgen failed${NC}"
  exit 1
fi

echo -e "${GREEN}✓ wasm-bindgen successful${NC}"
echo ""

# Step 3: Optional - Optimize with wasm-opt (if installed)
if command -v wasm-opt &> /dev/null; then
  echo -e "${YELLOW}Step 3: Optimizing with wasm-opt...${NC}"
  
  wasm-opt pkg/csv_diff_wasm_bg.wasm \
    -O4 \
    --enable-threads \
    --enable-bulk-memory \
    -o pkg/csv_diff_wasm_bg.wasm
  
  echo -e "${GREEN}✓ Optimization complete${NC}"
else
  echo -e "${YELLOW}⚠ wasm-opt not found, skipping optimization${NC}"
  echo "Install with: npm install -g wasm-opt"
fi

echo ""

# Display results
echo -e "${GREEN}=== Build Complete ===${NC}"
echo "Output directory: pkg/"
echo "Files generated:"
ls -lh pkg/
echo ""
echo "Final WASM size: $(du -h pkg/csv_diff_wasm_bg.wasm | cut -f1)"
echo ""
echo -e "${YELLOW}Creating a small package entry to resolve worker imports...${NC}"

# Create a tiny index.js so `import('../../..')` inside workerHelpers resolves
# to the package root when bundlers look up a directory. Also write package.json
cat > pkg/index.js << 'JS'
// Auto-generated shim so that imports to the package root work from snippets.
export * from './csv_diff_wasm.js';
export { default } from './csv_diff_wasm.js';
JS

cat > pkg/package.json << 'JSON'
{
  "name": "csv-diff-wasm-local",
  "type": "module",
  "module": "csv_diff_wasm.js",
  "main": "csv_diff_wasm.js"
}
JSON

echo -e "${GREEN}✓ pkg/index.js and pkg/package.json created${NC}"
echo ""
echo -e "${GREEN}✓ Ready to use!${NC}"
