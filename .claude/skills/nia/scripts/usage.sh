#!/usr/bin/env bash
# Nia Usage — show your current API usage stats (requests, tokens, limits)
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

nia_get "$BASE_URL/usage"
