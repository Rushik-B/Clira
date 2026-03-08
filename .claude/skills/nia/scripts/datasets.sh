#!/usr/bin/env bash
# Nia Datasets — HuggingFace dataset management
# Usage: datasets.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── index — index a HuggingFace dataset so it becomes searchable
cmd_index() {
  if [ -z "$1" ]; then
    echo "Usage: datasets.sh index <dataset_name_or_url> [config]"
    echo "  Accepts: dataset name, owner/dataset, or full HF URL"
    echo "  Env: ADD_GLOBAL (true/false)"
    return 1
  fi
  DATA=$(jq -n --arg u "$1" --arg cfg "${2:-}" --arg ag "${ADD_GLOBAL:-}" \
    '{type: "huggingface_dataset", url: $u}
    + (if $cfg != "" then {config: $cfg} else {} end)
    + (if $ag != "" then {add_as_global_source: ($ag == "true")} else {} end)')
  nia_post "$BASE_URL/sources" "$DATA"
}

# ─── list — list all indexed HuggingFace datasets
cmd_list() {
  nia_get "$BASE_URL/sources?type=huggingface_dataset"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  index) shift; cmd_index "$@" ;;
  list)  shift; cmd_list "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  index   Index a HuggingFace dataset"
    echo "  list    List indexed datasets"
    exit 1
    ;;
esac
