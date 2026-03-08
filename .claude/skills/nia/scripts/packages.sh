#!/usr/bin/env bash
# Nia Packages — search package source code
# Usage: packages.sh <command> [args...]
# Registry: npm | py_pi | crates_io | golang_proxy
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── grep — regex search inside a published package's source code
cmd_grep() {
  if [ -z "$3" ]; then
    echo "Usage: packages.sh grep <registry> <package> <pattern> [version]"
    echo "  registry: npm | py_pi | crates_io | golang_proxy"
    echo "  Env: LANGUAGE, CONTEXT_BEFORE, CONTEXT_AFTER, CONTEXT_LINES, OUTPUT_MODE, HEAD_LIMIT, FILE_SHA256"
    return 1
  fi
  DATA=$(jq -n \
    --arg r "$1" --arg p "$2" --arg pat "$3" --arg ver "${4:-}" \
    --arg lang "${LANGUAGE:-}" --arg cb "${CONTEXT_BEFORE:-}" --arg ca "${CONTEXT_AFTER:-}" \
    --arg cl "${CONTEXT_LINES:-}" --arg om "${OUTPUT_MODE:-}" --arg hl "${HEAD_LIMIT:-20}" --arg sha "${FILE_SHA256:-}" \
    '{registry: $r, package_name: $p, pattern: $pat, head_limit: ($hl | tonumber)}
    + (if $ver != "" then {version: $ver} else {} end)
    + (if $lang != "" then {language: $lang} else {} end)
    + (if $cb != "" then {b: ($cb | tonumber)} else {} end)
    + (if $ca != "" then {a: ($ca | tonumber)} else {} end)
    + (if $cl != "" then {c: ($cl | tonumber)} else {} end)
    + (if $om != "" then {output_mode: $om} else {} end)
    + (if $sha != "" then {filename_sha256: $sha} else {} end)')
  nia_post "$BASE_URL/packages/grep" "$DATA"
}

# ─── hybrid — semantic + regex combo search across a package's source files
cmd_hybrid() {
  if [ -z "$3" ]; then
    echo "Usage: packages.sh hybrid <registry> <package> <query> [version]"
    echo "  registry: npm | py_pi | crates_io | golang_proxy"
    echo "  Env: PATTERN (regex pre-filter), LANGUAGE, FILE_SHA256"
    return 1
  fi
  DATA=$(jq -n \
    --arg r "$1" --arg p "$2" --arg q "$3" --arg ver "${4:-}" \
    --arg pat "${PATTERN:-}" --arg lang "${LANGUAGE:-}" --arg sha "${FILE_SHA256:-}" \
    '{registry: $r, package_name: $p, semantic_queries: [$q]}
    + (if $ver != "" then {version: $ver} else {} end)
    + (if $pat != "" then {pattern: $pat} else {} end)
    + (if $lang != "" then {language: $lang} else {} end)
    + (if $sha != "" then {filename_sha256: $sha} else {} end)')
  nia_post "$BASE_URL/packages/search" "$DATA"
}

# ─── read — read specific lines from a package file by its SHA256 hash
cmd_read() {
  if [ -z "$5" ]; then
    echo "Usage: packages.sh read <registry> <package> <filename_sha256> <start_line> <end_line> [version]"
    return 1
  fi
  DATA=$(jq -n \
    --arg reg "$1" --arg pkg "$2" --arg sha "$3" \
    --argjson start "$4" --argjson end "$5" --arg ver "${6:-}" \
    '{registry: $reg, package_name: $pkg, filename_sha256: $sha, start_line: $start, end_line: $end}
    + (if $ver != "" then {version: $ver} else {} end)')
  nia_post "$BASE_URL/packages/read" "$DATA"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  grep)   shift; cmd_grep "$@" ;;
  hybrid) shift; cmd_hybrid "$@" ;;
  read)   shift; cmd_read "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  grep    Regex search in package source code"
    echo "  hybrid  Semantic + regex search in package code"
    echo "  read    Read lines from a package file"
    exit 1
    ;;
esac
