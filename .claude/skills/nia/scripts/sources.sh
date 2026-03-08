#!/usr/bin/env bash
# Nia Sources — unified source management
# Usage: sources.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── index — crawl and index a documentation site, PDF, or any URL
cmd_index() {
  if [ -z "$1" ]; then
    echo "Usage: sources.sh index 'https://docs.example.com' [limit]"
    echo ""
    echo "Environment variables:"
    echo "  DISPLAY_NAME          Custom display name"
    echo "  FOCUS                 Focus instructions (e.g. 'Only API reference')"
    echo "  EXTRACT_BRANDING      Extract brand colors, logos, fonts (true/false)"
    echo "  EXTRACT_IMAGES        Extract all image URLs (true/false)"
    echo "  IS_PDF                Direct PDF URL (true/false)"
    echo "  URL_PATTERNS          Comma-separated include patterns"
    echo "  EXCLUDE_PATTERNS      Comma-separated exclude patterns"
    echo "  MAX_DEPTH             Maximum crawl depth (default: 20)"
    echo "  WAIT_FOR              Wait for page load in ms (default: 2000)"
    echo "  CHECK_LLMS_TXT        Check for llms.txt (true/false, default: true)"
    echo "  LLMS_TXT_STRATEGY     prefer|only|ignore (default: prefer)"
    echo "  INCLUDE_SCREENSHOT    Include full page screenshot (true/false)"
    echo "  ONLY_MAIN_CONTENT     Extract only main content (true/false, default: true)"
    echo "  ADD_GLOBAL            Add as global source (true/false, default: true)"
    echo "  MAX_AGE               Cache max age in seconds"
    return 1
  fi
  local url="$1" limit="${2:-1000}"
  DATA=$(jq -n \
    --arg u "$url" \
    --argjson l "$limit" \
    --arg display_name "${DISPLAY_NAME:-}" \
    --arg focus "${FOCUS:-}" \
    --arg extract_branding "${EXTRACT_BRANDING:-}" \
    --arg extract_images "${EXTRACT_IMAGES:-}" \
    --arg is_pdf "${IS_PDF:-}" \
    --arg url_patterns "${URL_PATTERNS:-}" \
    --arg exclude_patterns "${EXCLUDE_PATTERNS:-}" \
    --arg max_depth "${MAX_DEPTH:-}" \
    --arg wait_for "${WAIT_FOR:-}" \
    --arg check_llms_txt "${CHECK_LLMS_TXT:-}" \
    --arg llms_txt_strategy "${LLMS_TXT_STRATEGY:-}" \
    --arg include_screenshot "${INCLUDE_SCREENSHOT:-}" \
    --arg only_main_content "${ONLY_MAIN_CONTENT:-true}" \
    --arg add_global "${ADD_GLOBAL:-}" \
    --arg max_age "${MAX_AGE:-}" \
    '{type: "documentation", url: $u, limit: $l, only_main_content: ($only_main_content == "true")}
    + (if $display_name != "" then {display_name: $display_name} else {} end)
    + (if $focus != "" then {focus_instructions: $focus} else {} end)
    + (if $extract_branding != "" then {extract_branding: ($extract_branding == "true")} else {} end)
    + (if $extract_images != "" then {extract_images: ($extract_images == "true")} else {} end)
    + (if $is_pdf != "" then {is_pdf: ($is_pdf == "true")} else {} end)
    + (if $url_patterns != "" then {url_patterns: ($url_patterns | split(","))} else {} end)
    + (if $exclude_patterns != "" then {exclude_patterns: ($exclude_patterns | split(","))} else {} end)
    + (if $max_depth != "" then {max_depth: ($max_depth | tonumber)} else {} end)
    + (if $wait_for != "" then {wait_for: ($wait_for | tonumber)} else {} end)
    + (if $check_llms_txt != "" then {check_llms_txt: ($check_llms_txt == "true")} else {} end)
    + (if $llms_txt_strategy != "" then {llms_txt_strategy: $llms_txt_strategy} else {} end)
    + (if $include_screenshot != "" then {include_screenshot: ($include_screenshot == "true")} else {} end)
    + (if $add_global != "" then {add_as_global_source: ($add_global == "true")} else {} end)
    + (if $max_age != "" then {max_age: ($max_age | tonumber)} else {} end)')
  nia_post "$BASE_URL/sources" "$DATA"
}

# ─── list — list all indexed sources, optionally filtered by type
cmd_list() {
  local type="${1:-}"
  local url="$BASE_URL/sources"
  if [ -n "$type" ]; then url="${url}?type=${type}"; fi
  nia_get "$url"
}

# ─── get — fetch full details for a single source by ID
cmd_get() {
  if [ -z "$1" ]; then echo "Usage: sources.sh get <source_id> [type]"; return 1; fi
  local sid=$(resolve_source_id "$1" "${2:-}") type="${2:-}"
  local url="$BASE_URL/sources/${sid}"
  if [ -n "$type" ]; then url="${url}?type=${type}"; fi
  nia_get "$url"
}

# ─── resolve — look up a source by name, URL, or identifier
cmd_resolve() {
  if [ -z "$1" ]; then echo "Usage: sources.sh resolve <identifier> [type]"; return 1; fi
  local id=$(echo "$1" | sed 's/ /%20/g') type="${2:-}"
  local url="$BASE_URL/sources/resolve?identifier=${id}"
  if [ -n "$type" ]; then url="${url}&type=${type}"; fi
  nia_get "$url"
}

# ─── update — change a source's display name or category assignment
cmd_update() {
  if [ -z "$1" ]; then echo "Usage: sources.sh update <source_id> [display_name] [category_id]"; return 1; fi
  local sid=$(resolve_source_id "$1") dname="${2:-}" cat_id="${3:-}"
  DATA=$(jq -n --arg dn "$dname" --arg cat "$cat_id" \
    '{} + (if $dn != "" then {display_name: $dn} else {} end)
       + (if $cat == "null" then {category_id: null} elif $cat != "" then {category_id: $cat} else {} end)')
  local url="$BASE_URL/sources/${sid}"
  if [ -n "${TYPE:-}" ]; then url="${url}?type=${TYPE}"; fi
  nia_patch "$url" "$DATA"
}

# ─── delete — remove a source and all its indexed content
cmd_delete() {
  if [ -z "$1" ]; then echo "Usage: sources.sh delete <source_id> [type]"; return 1; fi
  local sid=$(resolve_source_id "$1" "${2:-}") type="${2:-}"
  local url="$BASE_URL/sources/${sid}"
  if [ -n "$type" ]; then url="${url}?type=${type}"; fi
  nia_delete "$url"
}

# ─── sync — re-index a source to pick up upstream changes
cmd_sync() {
  if [ -z "$1" ]; then echo "Usage: sources.sh sync <source_id> [type]"; return 1; fi
  local sid=$(resolve_source_id "$1" "${2:-}") type="${2:-}"
  local url="$BASE_URL/sources/${sid}/sync"
  if [ -n "$type" ]; then url="${url}?type=${type}"; fi
  nia_post "$url" "{}"
}

# ─── rename — change the display name of any source
cmd_rename() {
  if [ -z "$1" ] || [ -z "$2" ]; then echo "Usage: sources.sh rename <source_id> <new_name>"; return 1; fi
  local sid=$(resolve_source_id "$1")
  DATA=$(jq -n --arg name "$2" '{display_name: $name}')
  nia_patch "$BASE_URL/sources/${sid}" "$DATA"
}

# ─── subscribe — add a publicly indexed global source to your account
cmd_subscribe() {
  if [ -z "$1" ]; then
    echo "Usage: sources.sh subscribe <url> [source_type] [ref]"
    echo "  source_type: repository|documentation|research_paper|huggingface_dataset"
    return 1
  fi
  DATA=$(jq -n --arg u "$1" --arg st "${2:-}" --arg ref "${3:-}" \
    '{url: $u} + (if $st != "" then {source_type: $st} else {} end) + (if $ref != "" then {ref: $ref} else {} end)')
  nia_post "$BASE_URL/sources/subscribe" "$DATA"
}

# ─── read — read file content from an indexed source by path and optional line range
cmd_read() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: sources.sh read <source_id> <path> [line_start] [line_end]"
    echo "  MAX_LENGTH  Max characters to return (100-100000)"
    return 1
  fi
  local sid=$(resolve_source_id "$1") path=$(echo "$2" | sed 's/ /%20/g')
  local url="$BASE_URL/sources/${sid}/content?path=${path}"
  if [ -n "${3:-}" ]; then url="${url}&line_start=$3"; fi
  if [ -n "${4:-}" ]; then url="${url}&line_end=$4"; fi
  if [ -n "${MAX_LENGTH:-}" ]; then url="${url}&max_length=${MAX_LENGTH}"; fi
  nia_get_raw "$url" | jq -r '.content // .'
}

# ─── grep — regex search across all files in a source
cmd_grep() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: sources.sh grep <source_id> <pattern> [path]"
    echo "  Env: CASE_SENSITIVE, WHOLE_WORD, FIXED_STRING, OUTPUT_MODE,"
    echo "       HIGHLIGHT, EXHAUSTIVE, LINES_AFTER, LINES_BEFORE, MAX_PER_FILE, MAX_TOTAL"
    return 1
  fi
  local sid=$(resolve_source_id "$1")
  DATA=$(build_grep_json "$2" "${3:-}")
  nia_post "$BASE_URL/sources/${sid}/grep" "$DATA"
}

# ─── tree — print the full file tree of a source
cmd_tree() {
  if [ -z "$1" ]; then echo "Usage: sources.sh tree <source_id>"; return 1; fi
  local sid=$(resolve_source_id "$1")
  nia_get_raw "$BASE_URL/sources/${sid}/tree" | jq '.tree_string // .'
}

# ─── ls — list files/dirs in a specific path within a source
cmd_ls() {
  if [ -z "$1" ]; then echo "Usage: sources.sh ls <source_id> [path]"; return 1; fi
  local sid=$(resolve_source_id "$1") dir=$(echo "${2:-/}" | jq -Rr @uri)
  nia_get "$BASE_URL/sources/${sid}/tree?path=${dir}"
}

# ─── classification — get or update the auto-classification for a source
cmd_classification() {
  if [ -z "$1" ]; then echo "Usage: sources.sh classification <source_id> [type]"; return 1; fi
  local sid=$(resolve_source_id "$1" "${2:-}") type="${2:-}"
  local url="$BASE_URL/sources/${sid}/classification"
  if [ -n "$type" ]; then url="${url}?type=${type}"; fi
  if [ "${ACTION:-}" = "update" ]; then
    nia_patch "$url" "{}"
  else
    nia_get "$url"
  fi
}

# ─── assign-category — assign (or remove with 'null') a category for a source
cmd_assign_category() {
  if [ -z "$1" ] || [ -z "$2" ]; then echo "Usage: sources.sh assign-category <source_id> <category_id|null>"; return 1; fi
  local sid=$(resolve_source_id "$1") cat_id="$2"
  if [ "$cat_id" = "null" ]; then
    DATA='{"category_id": null}'
  else
    DATA=$(jq -n --arg c "$cat_id" '{category_id: $c}')
  fi
  nia_patch "$BASE_URL/sources/${sid}" "$DATA"
}

# ─── upload-url — get a signed URL for direct PDF upload
cmd_upload_url() {
  if [ -z "$1" ]; then
    echo "Usage: sources.sh upload-url <filename>"
    echo "  Returns signed URL for HTTP PUT upload and gcs_path for create-source"
    return 1
  fi
  DATA=$(jq -n --arg fn "$1" '{filename: $fn, content_type: "application/pdf"}')
  nia_post "$BASE_URL/sources/upload-url" "$DATA"
}

# ─── bulk-delete — delete multiple resources in a single request
cmd_bulk_delete() {
  if [ -z "$1" ]; then
    echo "Usage: sources.sh bulk-delete <id:type> [id:type ...]"
    echo "  type: repository|documentation|research_paper|context|local_folder|slack"
    echo "  Example: sources.sh bulk-delete abc123:repository def456:documentation"
    return 1
  fi
  local items="[]"
  for item in "$@"; do
    local id="${item%%:*}" type="${item#*:}"
    items=$(echo "$items" | jq --arg id "$id" --arg t "$type" '. + [{id: $id, type: $t}]')
  done
  DATA=$(jq -n --argjson items "$items" '{items: $items}')
  nia_post "$BASE_URL/bulk-delete" "$DATA"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  index)            shift; cmd_index "$@" ;;
  list)             shift; cmd_list "$@" ;;
  get)              shift; cmd_get "$@" ;;
  resolve)          shift; cmd_resolve "$@" ;;
  update)           shift; cmd_update "$@" ;;
  delete)           shift; cmd_delete "$@" ;;
  sync)             shift; cmd_sync "$@" ;;
  rename)           shift; cmd_rename "$@" ;;
  subscribe)        shift; cmd_subscribe "$@" ;;
  read)             shift; cmd_read "$@" ;;
  grep)             shift; cmd_grep "$@" ;;
  tree)             shift; cmd_tree "$@" ;;
  ls)               shift; cmd_ls "$@" ;;
  classification)   shift; cmd_classification "$@" ;;
  assign-category)  shift; cmd_assign_category "$@" ;;
  upload-url)       shift; cmd_upload_url "$@" ;;
  bulk-delete)      shift; cmd_bulk_delete "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  index            Index a documentation site"
    echo "  list [type]      List sources (repo|documentation|research_paper|huggingface_dataset|local_folder|slack)"
    echo "  get              Get source details"
    echo "  resolve          Resolve source by name/URL"
    echo "  update           Update source display name / category"
    echo "  delete           Delete a source"
    echo "  sync             Re-sync a source"
    echo "  rename           Rename a data source"
    echo "  subscribe        Subscribe to a globally indexed source"
    echo "  read             Read content from a source"
    echo "  grep             Search source content with regex"
    echo "  tree             Get source file tree"
    echo "  ls               List directory in source"
    echo "  classification   Get/update source classification"
    echo "  assign-category  Assign category to source"
    echo "  upload-url       Get signed URL for PDF upload"
    echo "  bulk-delete      Delete multiple resources at once"
    exit 1
    ;;
esac
