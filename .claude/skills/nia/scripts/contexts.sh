#!/usr/bin/env bash
# Nia Contexts — cross-agent conversation context sharing
# Usage: contexts.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── save — persist a conversation context so other agents can retrieve it later
cmd_save() {
  if [ -z "$4" ]; then
    echo "Usage: contexts.sh save <title> <summary> <content> <agent_source>"
    echo "  Env: TAGS (csv), MEMORY_TYPE (scratchpad|episodic|fact|procedural), TTL_SECONDS, WORKSPACE"
    return 1
  fi
  DATA=$(jq -n \
    --arg title "$1" --arg summary "$2" --arg content "$3" --arg agent "$4" \
    --arg tags "${TAGS:-}" --arg mt "${MEMORY_TYPE:-}" --arg ttl "${TTL_SECONDS:-}" --arg ws "${WORKSPACE:-}" \
    '{title: $title, summary: $summary, content: $content, agent_source: $agent}
    + (if $tags != "" then {tags: ($tags | split(","))} else {} end)
    + (if $mt != "" then {memory_type: $mt} else {} end)
    + (if $ttl != "" then {ttl_seconds: ($ttl | tonumber)} else {} end)
    + (if $ws != "" then {workspace_override: $ws} else {} end)')
  nia_post "$BASE_URL/contexts" "$DATA"
}

# ─── list — list saved contexts, filterable by tags/agent/memory type
cmd_list() {
  local limit="${1:-20}" offset="${2:-0}"
  local url="$BASE_URL/contexts?limit=${limit}&offset=${offset}"
  if [ -n "${TAGS:-}" ]; then url="${url}&tags=${TAGS}"; fi
  if [ -n "${AGENT_SOURCE:-}" ]; then url="${url}&agent_source=${AGENT_SOURCE}"; fi
  if [ -n "${MEMORY_TYPE:-}" ]; then url="${url}&memory_type=${MEMORY_TYPE}"; fi
  nia_get "$url"
}

# ─── search — keyword/text search across all saved contexts
cmd_search() {
  if [ -z "$1" ]; then echo "Usage: contexts.sh search <query> [limit]"; return 1; fi
  local q=$(echo "$1" | sed 's/ /%20/g') limit="${2:-20}"
  local url="$BASE_URL/contexts/search?q=${q}&limit=${limit}"
  if [ -n "${TAGS:-}" ]; then url="${url}&tags=${TAGS}"; fi
  if [ -n "${AGENT_SOURCE:-}" ]; then url="${url}&agent_source=${AGENT_SOURCE}"; fi
  nia_get "$url"
}

# ─── semantic-search — vector similarity search across saved contexts
cmd_semantic_search() {
  if [ -z "$1" ]; then echo "Usage: contexts.sh semantic-search <query> [limit]"; return 1; fi
  local q=$(echo "$1" | sed 's/ /%20/g') limit="${2:-20}"
  local url="$BASE_URL/contexts/semantic-search?q=${q}&limit=${limit}"
  if [ -n "${WORKSPACE_FILTER:-}" ]; then url="${url}&workspace_filter=${WORKSPACE_FILTER}"; fi
  if [ -n "${INCLUDE_HIGHLIGHTS:-}" ]; then url="${url}&include_highlights=${INCLUDE_HIGHLIGHTS}"; fi
  nia_get "$url"
}

# ─── get — retrieve a single context by its ID
cmd_get() {
  if [ -z "$1" ]; then echo "Usage: contexts.sh get <context_id>"; return 1; fi
  nia_get "$BASE_URL/contexts/$1"
}

# ─── update — modify an existing context's title, summary, content, or tags
cmd_update() {
  if [ -z "$1" ]; then
    echo "Usage: contexts.sh update <context_id> [title] [summary] [content]"
    echo "  Pass '' to skip a field. Env: TAGS, MEMORY_TYPE, TTL_SECONDS"
    return 1
  fi
  DATA=$(jq -n \
    --arg title "${2:-}" --arg summary "${3:-}" --arg content "${4:-}" \
    --arg tags "${TAGS:-}" --arg mt "${MEMORY_TYPE:-}" --arg ttl "${TTL_SECONDS:-}" \
    '{} + (if $title != "" then {title: $title} else {} end)
       + (if $summary != "" then {summary: $summary} else {} end)
       + (if $content != "" then {content: $content} else {} end)
       + (if $tags != "" then {tags: ($tags | split(","))} else {} end)
       + (if $mt != "" then {memory_type: $mt} else {} end)
       + (if $ttl != "" then {ttl_seconds: ($ttl | tonumber)} else {} end)')
  nia_put "$BASE_URL/contexts/$1" "$DATA"
}

# ─── delete — permanently remove a saved context
cmd_delete() {
  if [ -z "$1" ]; then echo "Usage: contexts.sh delete <context_id>"; return 1; fi
  nia_delete "$BASE_URL/contexts/$1"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  save)            shift; cmd_save "$@" ;;
  list)            shift; cmd_list "$@" ;;
  search)          shift; cmd_search "$@" ;;
  semantic-search) shift; cmd_semantic_search "$@" ;;
  get)             shift; cmd_get "$@" ;;
  update)          shift; cmd_update "$@" ;;
  delete)          shift; cmd_delete "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  save             Save conversation context"
    echo "  list             List contexts [limit] [offset]"
    echo "  search           Text search contexts"
    echo "  semantic-search  Semantic search contexts"
    echo "  get              Get context by ID"
    echo "  update           Update a context"
    echo "  delete           Delete a context"
    exit 1
    ;;
esac
