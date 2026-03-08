#!/usr/bin/env bash
# Nia Local Folders — private file storage and search
# Usage: folders.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# helper: scan local dir into JSON files array
_scan_folder() {
  local folder_path="$1"
  local files_json="[]"
  while IFS= read -r -d '' file; do
    local rel="${file#$folder_path/}"
    if file "$file" | grep -q "text"; then
      local content
      content=$(cat "$file" 2>/dev/null || echo "")
      if [ -n "$content" ]; then
        files_json=$(echo "$files_json" | jq --arg p "$rel" --arg c "$content" '. + [{path: $p, content: $c}]')
      fi
    fi
  done < <(find "$folder_path" -type f -not -path '*/\.*' -not -name '*.pyc' -not -name '*.o' -not -name '*.so' -print0 2>/dev/null)
  echo "$files_json"
}

# ─── create — upload a local directory to Nia as a private, searchable folder
cmd_create() {
  if [ -z "$1" ]; then echo "Usage: folders.sh create /path/to/folder [display_name]"; return 1; fi
  if [ ! -d "$1" ]; then echo "Error: Directory not found: $1"; return 1; fi
  local name="${2:-$(basename "$1")}"
  local files_json
  files_json=$(_scan_folder "$1")
  local count
  count=$(echo "$files_json" | jq 'length')
  echo "Found $count text files to index"
  if [ "$count" -eq 0 ]; then echo "Error: No indexable files"; return 1; fi
  DATA=$(jq -n --arg name "$name" --arg path "$1" --argjson files "$files_json" \
    '{folder_name: $name, folder_path: $path, files: $files}')
  nia_post "$BASE_URL/local-folders" "$DATA"
}

# ─── list — list all local folders, optionally filtered by status
cmd_list() {
  local limit="${1:-50}" offset="${2:-0}"
  local url="$BASE_URL/local-folders?limit=${limit}&offset=${offset}"
  if [ -n "${STATUS:-}" ]; then url="${url}&status=${STATUS}"; fi
  nia_get "$url"
}

# ─── get — fetch details for a single local folder by ID
cmd_get() {
  if [ -z "$1" ]; then echo "Usage: folders.sh get <folder_id>"; return 1; fi
  nia_get "$BASE_URL/local-folders/$1"
}

# ─── delete — remove a local folder and its indexed content
cmd_delete() {
  if [ -z "$1" ]; then echo "Usage: folders.sh delete <folder_id>"; return 1; fi
  nia_delete "$BASE_URL/local-folders/$1"
}

# ─── rename — change the display name of a local folder
cmd_rename() {
  if [ -z "$1" ] || [ -z "$2" ]; then echo "Usage: folders.sh rename <folder_id> <new_name>"; return 1; fi
  DATA=$(jq -n --arg name "$2" '{new_name: $name}')
  nia_patch "$BASE_URL/local-folders/$1/rename" "$DATA"
}

# ─── tree — print the file tree of a local folder
cmd_tree() {
  if [ -z "$1" ]; then echo "Usage: folders.sh tree <folder_id>"; return 1; fi
  nia_get_raw "$BASE_URL/local-folders/$1/tree" | jq '.formatted_tree // .'
}

# ─── ls — list files and subdirectories at a path in a local folder
cmd_ls() {
  if [ -z "$1" ]; then echo "Usage: folders.sh ls <folder_id> [path]"; return 1; fi
  local dir=$(echo "${2:-/}" | sed 's/ /%20/g')
  nia_get "$BASE_URL/local-folders/$1/ls?path=${dir}"
}

# ─── read — read file content from a local folder by path and optional line range
cmd_read() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: folders.sh read <folder_id> <file_path> [line_start] [line_end]"
    echo "  Env: MAX_LENGTH"
    return 1
  fi
  local fpath=$(echo "$2" | sed 's/ /%20/g')
  local url="$BASE_URL/local-folders/$1/read?path=${fpath}"
  if [ -n "${3:-}" ]; then url="${url}&line_start=$3"; fi
  if [ -n "${4:-}" ]; then url="${url}&line_end=$4"; fi
  if [ -n "${MAX_LENGTH:-}" ]; then url="${url}&max_length=${MAX_LENGTH}"; fi
  nia_get_raw "$url" | jq -r '.content // .'
}

# ─── grep — regex search across all files in a local folder
cmd_grep() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: folders.sh grep <folder_id> <pattern> [path_prefix]"
    echo "  Env: CASE_SENSITIVE, WHOLE_WORD, FIXED_STRING, OUTPUT_MODE,"
    echo "       HIGHLIGHT, EXHAUSTIVE, LINES_AFTER, LINES_BEFORE, MAX_PER_FILE, MAX_TOTAL"
    return 1
  fi
  DATA=$(build_grep_json "$2" "${3:-}")
  nia_post "$BASE_URL/local-folders/$1/grep" "$DATA"
}

# ─── classify — auto-classify folder files into your categories using AI
cmd_classify() {
  if [ -z "$1" ]; then
    echo "Usage: folders.sh classify <folder_id> [categories_csv]"
    echo "  categories_csv  Comma-separated category names (uses existing categories if omitted)"
    return 1
  fi
  local cats="${2:-}"
  if [ -n "$cats" ]; then
    DATA=$(jq -n --arg c "$cats" '{categories: ($c | split(","))}')
  else
    # Fetch existing categories and pass them
    local existing
    existing=$(nia_get_raw "$BASE_URL/categories" | jq -r '[.items[]?.name // empty] | join(",")')
    if [ -z "$existing" ]; then
      echo "Error: No categories found. Create some first with: categories.sh create <name>"
      return 1
    fi
    DATA=$(jq -n --arg c "$existing" '{categories: ($c | split(","))}')
  fi
  nia_post "$BASE_URL/local-folders/$1/classify" "$DATA"
}

# ─── classification — get the current classification result for a folder
cmd_classification() {
  if [ -z "$1" ]; then echo "Usage: folders.sh classification <folder_id>"; return 1; fi
  nia_get "$BASE_URL/local-folders/$1/classification"
}

# ─── sync — re-upload local files to an existing folder to pick up changes
cmd_sync() {
  if [ -z "$1" ] || [ -z "$2" ]; then echo "Usage: folders.sh sync <folder_id> /path/to/folder"; return 1; fi
  if [ ! -d "$2" ]; then echo "Error: Directory not found: $2"; return 1; fi
  local files_json
  files_json=$(_scan_folder "$2")
  local count
  count=$(echo "$files_json" | jq 'length')
  echo "Syncing $count text files"
  DATA=$(jq -n --arg path "$2" --argjson files "$files_json" '{folder_path: $path, files: $files}')
  nia_post "$BASE_URL/local-folders/$1/sync" "$DATA"
}

# ─── from-db — create a searchable folder from a database query result
cmd_from_db() {
  if [ -z "$3" ]; then
    echo "Usage: folders.sh from-db <name> <connection_string> <query>"
    echo "  Env: TABLE, DB_TYPE, COLUMNS"
    return 1
  fi
  DATA=$(jq -n \
    --arg name "$1" --arg conn "$2" --arg query "$3" \
    --arg table "${TABLE:-}" --arg dbtype "${DB_TYPE:-}" --arg cols "${COLUMNS:-}" \
    '{folder_name: $name, connection_string: $conn, query: $query}
    + (if $table != "" then {table: $table} else {} end)
    + (if $dbtype != "" then {db_type: $dbtype} else {} end)
    + (if $cols != "" then {columns: ($cols | split(","))} else {} end)')
  nia_post "$BASE_URL/local-folders/from-database" "$DATA"
}

# ─── preview-db — preview rows from a database query before creating a folder
cmd_preview_db() {
  if [ -z "$2" ]; then
    echo "Usage: folders.sh preview-db <connection_string> <query>"
    echo "  Env: TABLE, DB_TYPE, COLUMNS, LIMIT"
    return 1
  fi
  DATA=$(jq -n \
    --arg conn "$1" --arg query "$2" \
    --arg table "${TABLE:-}" --arg dbtype "${DB_TYPE:-}" --arg cols "${COLUMNS:-}" \
    --arg limit "${LIMIT:-5}" \
    '{connection_string: $conn, query: $query, limit: ($limit | tonumber)}
    + (if $table != "" then {table: $table} else {} end)
    + (if $dbtype != "" then {db_type: $dbtype} else {} end)
    + (if $cols != "" then {columns: ($cols | split(","))} else {} end)')
  nia_post "$BASE_URL/local-folders/preview-db" "$DATA"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  create)          shift; cmd_create "$@" ;;
  list)            shift; cmd_list "$@" ;;
  get)             shift; cmd_get "$@" ;;
  delete)          shift; cmd_delete "$@" ;;
  rename)          shift; cmd_rename "$@" ;;
  tree)            shift; cmd_tree "$@" ;;
  ls)              shift; cmd_ls "$@" ;;
  read)            shift; cmd_read "$@" ;;
  grep)            shift; cmd_grep "$@" ;;
  classify)        shift; cmd_classify "$@" ;;
  classification)  shift; cmd_classification "$@" ;;
  sync)            shift; cmd_sync "$@" ;;
  from-db)         shift; cmd_from_db "$@" ;;
  preview-db)      shift; cmd_preview_db "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  create          Create folder from local directory"
    echo "  list            List local folders"
    echo "  get             Get folder details"
    echo "  delete          Delete a folder"
    echo "  rename          Rename a folder"
    echo "  tree            Get folder file tree"
    echo "  ls              List directory in folder"
    echo "  read            Read file from folder"
    echo "  grep            Search folder content with regex"
    echo "  classify        Auto-classify folder into categories"
    echo "  classification  Get folder classification"
    echo "  sync            Re-sync folder from local path"
    echo "  from-db         Create folder from database query"
    echo "  preview-db      Preview database content"
    exit 1
    ;;
esac
