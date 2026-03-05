#!/usr/bin/env bash
# Nia Oracle — autonomous research agent
# Usage: oracle.sh <command> [args...]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# helper: build oracle body with optional repos/docs/format/model
_oracle_body() {
  local query="$1" repos="${2:-}" docs="${3:-}"
  DATA=$(jq -n --arg q "$query" '{query: $q}')
  if [ -n "$repos" ]; then DATA=$(echo "$DATA" | jq --arg r "$repos" '. + {repositories: ($r | split(","))}'); fi
  if [ -n "$docs" ]; then DATA=$(echo "$DATA" | jq --arg d "$docs" '. + {data_sources: ($d | split(","))}'); fi
  if [ -n "${OUTPUT_FORMAT:-}" ]; then DATA=$(echo "$DATA" | jq --arg f "$OUTPUT_FORMAT" '. + {output_format: $f}'); fi
  if [ -n "${MODEL:-}" ]; then DATA=$(echo "$DATA" | jq --arg m "$MODEL" '. + {model: $m}'); fi
  echo "$DATA"
}

# ─── run — execute an Oracle research query synchronously and wait for the result
cmd_run() {
  if [ -z "$1" ]; then
    echo "Usage: oracle.sh run <query> [repos_csv] [docs_csv]"
    echo "  Env: OUTPUT_FORMAT, MODEL (claude-opus-4-6|claude-sonnet-4-5-20250929|...)"
    return 1
  fi
  DATA=$(_oracle_body "$@")
  nia_post "$BASE_URL/oracle" "$DATA"
}

# ─── job — start an async Oracle research job, returns a job_id to poll later
cmd_job() {
  if [ -z "$1" ]; then
    echo "Usage: oracle.sh job <query> [repos_csv] [docs_csv]"
    echo "  Returns job_id — check with: oracle.sh job-status <job_id>"
    echo "  Env: OUTPUT_FORMAT, MODEL"
    return 1
  fi
  DATA=$(_oracle_body "$@")
  nia_post "$BASE_URL/oracle/jobs" "$DATA"
}

# ─── job-status — check progress and retrieve result of an async job
cmd_job_status() {
  if [ -z "$1" ]; then echo "Usage: oracle.sh job-status <job_id>"; return 1; fi
  nia_get "$BASE_URL/oracle/jobs/$1"
}

# ─── job-cancel — cancel a running async research job
cmd_job_cancel() {
  if [ -z "$1" ]; then echo "Usage: oracle.sh job-cancel <job_id>"; return 1; fi
  nia_delete "$BASE_URL/oracle/jobs/$1"
}

# ─── jobs-list — list all research jobs, optionally filtered by status
cmd_jobs_list() {
  local status="${1:-}" limit="${2:-20}"
  local url="$BASE_URL/oracle/jobs?limit=$limit"
  if [ -n "$status" ]; then url="$url&status=$status"; fi
  nia_get "$url"
}

# ─── sessions — list Oracle research sessions (conversation threads)
cmd_sessions() {
  local limit="${1:-20}"
  nia_get "$BASE_URL/oracle/sessions?limit=${limit}"
}

# ─── session-detail — get metadata and status for a specific session
cmd_session_detail() {
  if [ -z "$1" ]; then echo "Usage: oracle.sh session-detail <session_id>"; return 1; fi
  nia_get "$BASE_URL/oracle/sessions/$1"
}

# ─── session-messages — retrieve the full message history of a session
cmd_session_messages() {
  if [ -z "$1" ]; then echo "Usage: oracle.sh session-messages <session_id> [limit]"; return 1; fi
  nia_get "$BASE_URL/oracle/sessions/$1/messages?limit=${2:-100}"
}

# ─── session-chat — send a follow-up message to an existing session (SSE stream)
cmd_session_chat() {
  if [ -z "$1" ] || [ -z "$2" ]; then echo "Usage: oracle.sh session-chat <session_id> <message>"; return 1; fi
  DATA=$(jq -n --arg m "$2" '{message: $m}')
  nia_stream "$BASE_URL/oracle/sessions/$1/chat/stream" "$DATA"
}

# ─── session-delete — delete a research session and its chat messages
cmd_session_delete() {
  if [ -z "$1" ]; then echo "Usage: oracle.sh session-delete <session_id>"; return 1; fi
  nia_delete "$BASE_URL/oracle/sessions/$1"
}

# ─── 1m-usage — get daily usage for 1M context window models
cmd_1m_usage() {
  nia_get "$BASE_URL/oracle/1m-usage"
}

# ─── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-}" in
  run)              shift; cmd_run "$@" ;;
  job)              shift; cmd_job "$@" ;;
  job-status)       shift; cmd_job_status "$@" ;;
  job-cancel)       shift; cmd_job_cancel "$@" ;;
  jobs-list)        shift; cmd_jobs_list "$@" ;;
  sessions)         shift; cmd_sessions "$@" ;;
  session-detail)   shift; cmd_session_detail "$@" ;;
  session-messages) shift; cmd_session_messages "$@" ;;
  session-chat)     shift; cmd_session_chat "$@" ;;
  session-delete)   shift; cmd_session_delete "$@" ;;
  1m-usage)         shift; cmd_1m_usage "$@" ;;
  *)
    echo "Usage: $(basename "$0") <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  run              Run Oracle research (synchronous)"
    echo "  job              Create async research job"
    echo "  job-status       Get job status/result"
    echo "  job-cancel       Cancel a running job"
    echo "  jobs-list        List jobs [status] [limit]"
    echo "  sessions         List research sessions"
    echo "  session-detail   Get session details"
    echo "  session-messages Get session messages"
    echo "  session-chat     Follow-up chat on session (SSE stream)"
    echo "  session-delete   Delete a session"
    echo "  1m-usage         Get daily 1M context usage"
    exit 1
    ;;
esac
