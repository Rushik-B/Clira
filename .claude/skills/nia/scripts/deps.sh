#!/usr/bin/env bash
# Nia Dependencies — analyze and subscribe to dependency docs
# Usage: deps.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── analyze — parse a manifest file and return its dependency list with docs links
cmd_analyze() {
  if [ -z "$1" ]; then echo "Usage: deps.sh analyze <manifest_file>"; return 1; fi
  if [ ! -f "$1" ]; then echo "Error: File not found: $1"; return 1; fi
  local content filename
  content=$(cat "$1")
  filename=$(basename "$1")
  DATA=$(jq -n --arg content "$content" --arg filename "$filename" \
    '{manifest_content: $content, filename: $filename}')
  nia_post "$BASE_URL/dependencies/analyze" "$DATA"
}

# ─── subscribe — auto-index documentation for every dependency in a manifest
cmd_subscribe() {
  if [ -z "$1" ]; then
    echo "Usage: deps.sh subscribe <manifest_file> [max_new_indexes]"
    echo "  Env: INCLUDE_DEV (true/false)"
    return 1
  fi
  if [ ! -f "$1" ]; then echo "Error: File not found: $1"; return 1; fi
  local content filename max_new
  content=$(cat "$1")
  filename=$(basename "$1")
  max_new="${2:-150}"
  DATA=$(jq -n --arg content "$content" --arg filename "$filename" \
    --argjson max "$max_new" --arg dev "${INCLUDE_DEV:-false}" \
    '{manifest_content: $content, filename: $filename, max_new_indexes: $max,
     include_dev_dependencies: ($dev == "true")}')
  nia_post "$BASE_URL/dependencies/subscribe" "$DATA"
}

# ─── upload — upload a manifest file directly (multipart) and subscribe to deps
cmd_upload() {
  if [ -z "$1" ]; then
    echo "Usage: deps.sh upload <manifest_file> [max_new_indexes]"
    echo "  Env: INCLUDE_DEV (true/false)"
    return 1
  fi
  if [ ! -f "$1" ]; then echo "Error: File not found: $1"; return 1; fi
  local max_new="${2:-150}"
  curl -s -X POST "$BASE_URL/dependencies/upload" \
    -H "Authorization: Bearer $NIA_KEY" \
    -F "file=@$1" \
    -F "include_dev_dependencies=${INCLUDE_DEV:-false}" \
    -F "max_new_indexes=${max_new}" | jq '.'
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  analyze)   shift; cmd_analyze "$@" ;;
  subscribe) shift; cmd_subscribe "$@" ;;
  upload)    shift; cmd_upload "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  analyze    Analyze a package manifest file"
    echo "  subscribe  Subscribe to docs for all dependencies"
    echo "  upload     Upload manifest and subscribe (multipart)"
    exit 1
    ;;
esac
