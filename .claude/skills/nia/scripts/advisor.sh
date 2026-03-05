#!/usr/bin/env bash
# Nia Advisor — get AI code advice grounded in your indexed repos and docs
# Pass local files + a question; Nia searches your sources and returns a targeted answer.
# Usage: advisor.sh "query" <files...>
# Env: REPOS (csv), DOCS (csv), OUTPUT_FORMAT (explanation|checklist|diff|structured)
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

if [ -z "$1" ]; then
  echo "Usage: advisor.sh 'query' file1.py [file2.ts ...]"
  echo ""
  echo "Environment variables:"
  echo "  REPOS           Comma-separated repos to search against"
  echo "  DOCS            Comma-separated doc sources to search against"
  echo "  OUTPUT_FORMAT   explanation|checklist|diff|structured (default: explanation)"
  exit 1
fi

QUERY="$1"
shift

# Build files object from remaining args
FILES_JSON="{}"
for FILE in "$@"; do
  if [ -f "$FILE" ]; then
    CONTENT=$(cat "$FILE")
    FILES_JSON=$(echo "$FILES_JSON" | jq --arg path "$FILE" --arg content "$CONTENT" '. + {($path): $content}')
  else
    echo "Warning: File not found: $FILE" >&2
  fi
done

# Build search scope
SCOPE="{}"
if [ -n "${REPOS:-}" ]; then
  SCOPE=$(echo "$SCOPE" | jq --arg r "$REPOS" '. + {repositories: ($r | split(","))}')
fi
if [ -n "${DOCS:-}" ]; then
  SCOPE=$(echo "$SCOPE" | jq --arg d "$DOCS" '. + {data_sources: ($d | split(","))}')
fi

DATA=$(jq -n \
  --arg q "$QUERY" \
  --argjson files "$FILES_JSON" \
  --argjson scope "$SCOPE" \
  --arg fmt "${OUTPUT_FORMAT:-explanation}" \
  '{query: $q, codebase: {files: $files}, output_format: $fmt}
  + (if ($scope | length) > 0 then {search_scope: $scope} else {} end)')

nia_post "$BASE_URL/advisor" "$DATA"
