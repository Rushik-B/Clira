#!/usr/bin/env bash
# Nia Papers — research paper management
# Usage: papers.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── index — index an arXiv paper so its content becomes searchable
cmd_index() {
  if [ -z "$1" ]; then
    echo "Usage: papers.sh index <arxiv_url_or_id>"
    echo "  Accepts: arXiv ID (2301.00001), abs URL, or pdf URL"
    echo "  Env: ADD_GLOBAL (true/false), DISPLAY_NAME"
    return 1
  fi
  DATA=$(jq -n --arg u "$1" --arg dn "${DISPLAY_NAME:-}" --arg ag "${ADD_GLOBAL:-}" \
    '{type: "research_paper", url: $u}
    + (if $dn != "" then {display_name: $dn} else {} end)
    + (if $ag != "" then {add_as_global_source: ($ag == "true")} else {} end)')
  nia_post "$BASE_URL/sources" "$DATA"
}

# ─── list — list all indexed research papers
cmd_list() {
  nia_get "$BASE_URL/sources?type=research_paper"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  index) shift; cmd_index "$@" ;;
  list)  shift; cmd_list "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  index   Index a research paper"
    echo "  list    List indexed papers"
    exit 1
    ;;
esac
