#!/usr/bin/env bash
# Nia Categories — organize sources into categories
# Usage: categories.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── list — list all categories you've created
cmd_list() {
  nia_get "$BASE_URL/categories"
}

# ─── create — create a new category with optional color and sort order
cmd_create() {
  if [ -z "$1" ]; then echo "Usage: categories.sh create <name> [color] [order]"; return 1; fi
  DATA=$(jq -n --arg name "$1" --arg color "${2:-}" --arg order "${3:-}" \
    '{name: $name}
    + (if $color != "" then {color: $color} else {} end)
    + (if $order != "" then {order: ($order | tonumber)} else {} end)')
  nia_post "$BASE_URL/categories" "$DATA"
}

# ─── update — change a category's name, color, or sort order
cmd_update() {
  if [ -z "$1" ]; then echo "Usage: categories.sh update <category_id> [name] [color] [order]"; return 1; fi
  local cid="$1"; shift
  DATA=$(jq -n --arg name "${1:-}" --arg color "${2:-}" --arg order "${3:-}" \
    '{} + (if $name != "" then {name: $name} else {} end)
       + (if $color != "" then {color: $color} else {} end)
       + (if $order != "" then {order: ($order | tonumber)} else {} end)')
  nia_patch "$BASE_URL/categories/${cid}" "$DATA"
}

# ─── delete — delete a category (does not delete assigned sources)
cmd_delete() {
  if [ -z "$1" ]; then echo "Usage: categories.sh delete <category_id>"; return 1; fi
  nia_delete "$BASE_URL/categories/$1"
}

# ─── assign — assign a category to a source, or pass 'null' to remove it
cmd_assign() {
  if [ -z "$1" ] || [ -z "$2" ]; then echo "Usage: categories.sh assign <source_id> <category_id|null>"; return 1; fi
  local sid=$(urlencode "$1") cat_id="$2"
  if [ "$cat_id" = "null" ]; then DATA='{"category_id": null}'
  else DATA=$(jq -n --arg c "$cat_id" '{category_id: $c}'); fi
  nia_patch "$BASE_URL/data-sources/${sid}/category" "$DATA"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  list)   shift; cmd_list "$@" ;;
  create) shift; cmd_create "$@" ;;
  update) shift; cmd_update "$@" ;;
  delete) shift; cmd_delete "$@" ;;
  assign) shift; cmd_assign "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  list     List all categories"
    echo "  create   Create a category"
    echo "  update   Update a category"
    echo "  delete   Delete a category"
    echo "  assign   Assign category to a source (use 'null' to remove)"
    exit 1
    ;;
esac
