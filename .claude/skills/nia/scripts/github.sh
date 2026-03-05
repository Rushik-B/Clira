#!/usr/bin/env bash
# Nia GitHub — live GitHub search and repository exploration (no indexing required)
# Usage: github.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── glob — find files matching a glob pattern in a repo
cmd_glob() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: github.sh glob <owner/repo> <pattern> [ref]"
    echo "  pattern: glob (e.g., '*.py', 'src/**/*.ts')"
    return 1
  fi
  DATA=$(jq -n --arg repo "$1" --arg pat "$2" --arg ref "${3:-HEAD}" \
    '{repository: $repo, pattern: $pat, ref: $ref}')
  nia_post "$BASE_URL/github/glob" "$DATA"
}

# ─── read — read a file from a GitHub repo with optional line range
cmd_read() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: github.sh read <owner/repo> <path> [ref] [start_line] [end_line]"
    return 1
  fi
  DATA=$(jq -n --arg repo "$1" --arg path "$2" --arg ref "${3:-HEAD}" \
    --arg sl "${4:-}" --arg el "${5:-}" \
    '{repository: $repo, path: $path, ref: $ref}
    + (if $sl != "" then {start_line: ($sl | tonumber)} else {} end)
    + (if $el != "" then {end_line: ($el | tonumber)} else {} end)')
  nia_post "$BASE_URL/github/read" "$DATA"
}

# ─── search — code search using GitHub's Code Search API
cmd_search() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: github.sh search <owner/repo> <query> [per_page] [page]"
    return 1
  fi
  DATA=$(jq -n --arg repo "$2" --arg q "$1" \
    --argjson pp "${3:-30}" --argjson pg "${4:-1}" \
    '{query: $q, repository: $repo, per_page: $pp, page: $pg}')
  nia_post "$BASE_URL/github/search" "$DATA"
}

# ─── tree — get the file tree of a GitHub repo or subdirectory
cmd_tree() {
  if [ -z "$1" ]; then
    echo "Usage: github.sh tree <owner/repo> [ref] [path]"
    return 1
  fi
  local owner repo
  owner="${1%%/*}"
  repo="${1#*/}"
  local url="$BASE_URL/github/tree/${owner}/${repo}"
  local params=""
  if [ -n "${2:-}" ]; then params="${params}&ref=$2"; fi
  if [ -n "${3:-}" ]; then params="${params}&path=$3"; fi
  if [ -n "$params" ]; then url="${url}?${params#&}"; fi
  nia_get "$url"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  glob)   shift; cmd_glob "$@" ;;
  read)   shift; cmd_read "$@" ;;
  search) shift; cmd_search "$@" ;;
  tree)   shift; cmd_tree "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Live GitHub search and exploration — no indexing required."
    echo "Rate limited to 10 req/min by GitHub for code search."
    echo ""
    echo "Commands:"
    echo "  glob    Find files matching a glob pattern"
    echo "  read    Read a file (with optional line range)"
    echo "  search  Code search (GitHub Code Search API)"
    echo "  tree    Get repository file tree"
    echo ""
    echo "For indexed repo operations, use repos.sh instead."
    echo "For autonomous repo research, use tracer.sh."
    exit 1
    ;;
esac
