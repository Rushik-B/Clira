#!/usr/bin/env bash
# Nia Slack — workspace connection, channel config, message search
# Usage: slack.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ─── install — generate a Slack OAuth authorization URL
cmd_install() {
  DATA=$(jq -n --arg redirect "${REDIRECT_URI:-}" --arg scopes "${SCOPES:-}" \
    '{}
    + (if $redirect != "" then {redirect_uri: $redirect} else {} end)
    + (if $scopes != "" then {scopes: ($scopes | split(","))} else {} end)')
  nia_post "$BASE_URL/slack/install" "$DATA"
}

# ─── callback — exchange OAuth code for tokens (called after user authorizes)
cmd_callback() {
  if [ -z "$1" ]; then
    echo "Usage: slack.sh callback <code> [redirect_uri]"
    return 1
  fi
  DATA=$(jq -n --arg code "$1" --arg redirect "${2:-}" \
    '{code: $code}
    + (if $redirect != "" then {redirect_uri: $redirect} else {} end)')
  nia_post "$BASE_URL/slack/install/callback" "$DATA"
}

# ─── register-token — register an external Slack bot token (BYOT)
cmd_register_token() {
  if [ -z "$1" ]; then
    echo "Usage: slack.sh register-token <xoxb-bot-token> [workspace_name]"
    return 1
  fi
  DATA=$(jq -n --arg token "$1" --arg name "${2:-}" \
    '{bot_token: $token}
    + (if $name != "" then {name: $name} else {} end)')
  nia_post "$BASE_URL/slack/install/token" "$DATA"
}

# ─── list — list all Slack workspace connections
cmd_list() {
  nia_get "$BASE_URL/slack/installations"
}

# ─── get — get details for a specific installation
cmd_get() {
  if [ -z "$1" ]; then echo "Usage: slack.sh get <installation_id>"; return 1; fi
  nia_get "$BASE_URL/slack/installations/$1"
}

# ─── delete — disconnect a Slack workspace
cmd_delete() {
  if [ -z "$1" ]; then echo "Usage: slack.sh delete <installation_id>"; return 1; fi
  nia_delete "$BASE_URL/slack/installations/$1"
}

# ─── channels — list available channels from the workspace
cmd_channels() {
  if [ -z "$1" ]; then echo "Usage: slack.sh channels <installation_id>"; return 1; fi
  nia_get "$BASE_URL/slack/installations/$1/channels"
}

# ─── configure-channels — set which channels to index
cmd_configure_channels() {
  if [ -z "$1" ]; then
    echo "Usage: slack.sh configure-channels <installation_id> [mode]"
    echo "  mode: all (default) | selected"
    echo "  Env: INCLUDE_CHANNELS (csv of channel IDs), EXCLUDE_CHANNELS (csv)"
    return 1
  fi
  local mode="${2:-all}"
  DATA=$(jq -n --arg mode "$mode" \
    --arg inc "${INCLUDE_CHANNELS:-}" --arg exc "${EXCLUDE_CHANNELS:-}" \
    '{mode: $mode}
    + (if $inc != "" then {include_channels: ($inc | split(","))} else {} end)
    + (if $exc != "" then {exclude_channels: ($exc | split(","))} else {} end)')
  nia_post "$BASE_URL/slack/installations/$1/channels" "$DATA"
}

# ─── grep — BM25 keyword search over indexed Slack messages
cmd_grep() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: slack.sh grep <installation_id> <pattern> [channel] [limit]"
    return 1
  fi
  DATA=$(jq -n --arg pat "$2" --arg ch "${3:-}" --argjson lim "${4:-20}" \
    '{pattern: $pat, limit: $lim}
    + (if $ch != "" then {channel: $ch} else {} end)')
  nia_post "$BASE_URL/slack/installations/$1/grep" "$DATA"
}

# ─── index — trigger a full re-index of the Slack workspace
cmd_index() {
  if [ -z "$1" ]; then echo "Usage: slack.sh index <installation_id>"; return 1; fi
  nia_post "$BASE_URL/slack/installations/$1/index" "{}"
}

# ─── messages — read recent messages from a channel (live from Slack API)
cmd_messages() {
  if [ -z "$1" ]; then
    echo "Usage: slack.sh messages <installation_id> [channel] [limit]"
    return 1
  fi
  local url="$BASE_URL/slack/installations/$1/messages?limit=${3:-50}"
  if [ -n "${2:-}" ]; then url="${url}&channel=$2"; fi
  nia_get "$url"
}

# ─── status — get the indexing status for a workspace
cmd_status() {
  if [ -z "$1" ]; then echo "Usage: slack.sh status <installation_id>"; return 1; fi
  nia_get "$BASE_URL/slack/installations/$1/status"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  install)              shift; cmd_install "$@" ;;
  callback)             shift; cmd_callback "$@" ;;
  register-token)       shift; cmd_register_token "$@" ;;
  list)                 shift; cmd_list "$@" ;;
  get)                  shift; cmd_get "$@" ;;
  delete)               shift; cmd_delete "$@" ;;
  channels)             shift; cmd_channels "$@" ;;
  configure-channels)   shift; cmd_configure_channels "$@" ;;
  grep)                 shift; cmd_grep "$@" ;;
  index)                shift; cmd_index "$@" ;;
  messages)             shift; cmd_messages "$@" ;;
  status)               shift; cmd_status "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Slack workspace connection, channel configuration, and message search."
    echo ""
    echo "Commands:"
    echo "  install              Generate Slack OAuth URL"
    echo "  callback             Exchange OAuth code for tokens"
    echo "  register-token       Register external bot token (BYOT)"
    echo "  list                 List Slack installations"
    echo "  get                  Get installation details"
    echo "  delete               Disconnect workspace"
    echo "  channels             List available channels"
    echo "  configure-channels   Configure channels to index"
    echo "  grep                 Search indexed messages (BM25)"
    echo "  index                Trigger full re-index"
    echo "  messages             Read recent messages (live)"
    echo "  status               Get indexing status"
    exit 1
    ;;
esac
