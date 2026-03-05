#!/usr/bin/env bash
# Nia Repositories — repository management
# Usage: repos.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── index — index a GitHub repo so its code becomes searchable
cmd_index() {
  if [ -z "$1" ]; then
    echo "Usage: repos.sh index <owner/repo> [branch_or_ref] [display_name]"
    echo "  ADD_GLOBAL=false to keep private"
    return 1
  fi
  DATA=$(jq -n \
    --arg r "$1" --arg ref "${2:-}" --arg dn "${3:-${DISPLAY_NAME:-}}" --arg ag "${ADD_GLOBAL:-}" \
    '{type: "repository", repository: $r}
    + (if $ref != "" then {ref: $ref} else {} end)
    + (if $dn != "" then {display_name: $dn} else {} end)
    + (if $ag != "" then {add_as_global_source: ($ag == "true")} else {} end)')
  nia_post "$BASE_URL/sources" "$DATA"
}

# ─── list — list all indexed repositories
cmd_list() {
  nia_get "$BASE_URL/sources?type=repository"
}

# ─── status — check indexing progress and metadata for a repo
cmd_status() {
  if [ -z "$1" ]; then echo "Usage: repos.sh status <owner/repo>"; return 1; fi
  local rid=$(resolve_source_id "$1" repository)
  nia_get "$BASE_URL/sources/${rid}?type=repository"
}

# ─── read — read a single file's content from an indexed repo
cmd_read() {
  if [ -z "$1" ] || [ -z "$2" ]; then echo "Usage: repos.sh read <owner/repo> <path/to/file>"; return 1; fi
  local rid=$(resolve_source_id "$1" repository) fp=$(echo "$2" | sed 's/\//%2F/g')
  nia_get_raw "$BASE_URL/sources/${rid}/content?type=repository&path=${fp}" | jq -r '.content // .'
}

# ─── grep — regex search across all files in an indexed repo
cmd_grep() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: repos.sh grep <owner/repo> <pattern> [path_prefix]"
    echo "  Env: REF, CASE_SENSITIVE, WHOLE_WORD, FIXED_STRING, OUTPUT_MODE,"
    echo "       HIGHLIGHT, EXHAUSTIVE, LINES_AFTER, LINES_BEFORE, MAX_PER_FILE, MAX_TOTAL"
    return 1
  fi
  local rid=$(resolve_source_id "$1" repository)
  DATA=$(build_grep_json "$2" "${3:-}")
  if [ -n "${REF:-}" ]; then
    DATA=$(echo "$DATA" | jq --arg ref "$REF" '. + {ref: $ref}')
  fi
  nia_post "$BASE_URL/sources/${rid}/grep" "$DATA"
}

# ─── tree — print the file tree of an indexed repo, with optional filters
cmd_tree() {
  if [ -z "$1" ]; then
    echo "Usage: repos.sh tree <owner/repo> [branch]"
    echo "  Env: INCLUDE_PATHS, EXCLUDE_PATHS, FILE_EXTENSIONS, EXCLUDE_EXTENSIONS, SHOW_FULL_PATHS"
    return 1
  fi
  local rid=$(resolve_source_id "$1" repository) branch="${2:-}"
  local params=""
  if [ -n "$branch" ]; then params="${params}&branch=${branch}"; fi
  if [ -n "${INCLUDE_PATHS:-}" ]; then params="${params}&include_paths=${INCLUDE_PATHS}"; fi
  if [ -n "${EXCLUDE_PATHS:-}" ]; then params="${params}&exclude_paths=${EXCLUDE_PATHS}"; fi
  if [ -n "${FILE_EXTENSIONS:-}" ]; then params="${params}&file_extensions=${FILE_EXTENSIONS}"; fi
  if [ -n "${EXCLUDE_EXTENSIONS:-}" ]; then params="${params}&exclude_extensions=${EXCLUDE_EXTENSIONS}"; fi
  if [ "${SHOW_FULL_PATHS:-}" = "true" ]; then params="${params}&show_full_paths=true"; fi
  local url="$BASE_URL/sources/${rid}/tree?type=repository${params}"
  nia_get_raw "$url" | jq '.formatted_tree // .'
}

# ─── delete — remove an indexed repo and all its data
cmd_delete() {
  if [ -z "$1" ]; then echo "Usage: repos.sh delete <owner/repo>"; return 1; fi
  local rid=$(resolve_source_id "$1" repository)
  nia_delete "$BASE_URL/sources/${rid}?type=repository"
}

# ─── rename — change the display name of an indexed repo
cmd_rename() {
  if [ -z "$1" ] || [ -z "$2" ]; then echo "Usage: repos.sh rename <owner/repo> <new_name>"; return 1; fi
  local rid=$(resolve_source_id "$1" repository)
  DATA=$(jq -n --arg name "$2" '{display_name: $name}')
  nia_patch "$BASE_URL/sources/${rid}?type=repository" "$DATA"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  index)   shift; cmd_index "$@" ;;
  list)    shift; cmd_list "$@" ;;
  status)  shift; cmd_status "$@" ;;
  read)    shift; cmd_read "$@" ;;
  grep)    shift; cmd_grep "$@" ;;
  tree)    shift; cmd_tree "$@" ;;
  delete)  shift; cmd_delete "$@" ;;
  rename)  shift; cmd_rename "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  index    Index a GitHub repository"
    echo "  list     List indexed repositories"
    echo "  status   Get repository indexing status"
    echo "  read     Read a file from repository"
    echo "  grep     Search repository code with regex"
    echo "  tree     Get repository file tree"
    echo "  delete   Delete indexed repository"
    echo "  rename   Rename repository display name"
    exit 1
    ;;
esac
