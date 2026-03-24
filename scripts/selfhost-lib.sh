#!/usr/bin/env bash

set -euo pipefail

SELFHOST_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELFHOST_ENV_FILE="${SELFHOST_REPO_ROOT}/.env"
SELFHOST_ENV_EXAMPLE="${SELFHOST_REPO_ROOT}/.env.example"
SELFHOST_RUNTIME_DIR="${SELFHOST_REPO_ROOT}/.clira-runtime"
SELFHOST_DEFAULT_SA_PATH="./.clira-runtime/google-service-account.json"

selfhost_print_section() {
  printf '\n==> %s\n' "$1"
}

selfhost_require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    return 1
  fi
}

selfhost_ensure_env_file() {
  if [[ ! -f "${SELFHOST_ENV_FILE}" ]]; then
    cp "${SELFHOST_ENV_EXAMPLE}" "${SELFHOST_ENV_FILE}"
    printf 'Created %s from %s\n' "${SELFHOST_ENV_FILE}" "${SELFHOST_ENV_EXAMPLE}"
  fi
}

selfhost_ensure_runtime_dir() {
  mkdir -p "${SELFHOST_RUNTIME_DIR}/ai-traces"
}

selfhost_read_env_value() {
  local key="$1"
  if [[ ! -f "${SELFHOST_ENV_FILE}" ]]; then
    return 0
  fi

  awk -F= -v target="${key}" '
    $0 ~ "^[[:space:]]*" target "=" {
      value = substr($0, index($0, "=") + 1)
    }
    END {
      if (value != "") {
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]+$/, "", value)
        print value
      }
    }
  ' "${SELFHOST_ENV_FILE}"
}

selfhost_upsert_env() {
  local key="$1"
  local value="$2"
  local tmp_file

  tmp_file="$(mktemp)"

  awk -v target="${key}" -v replacement="${value}" '
    BEGIN { replaced = 0 }
    $0 ~ "^[[:space:]]*" target "=" {
      print target "=" replacement
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) {
        print target "=" replacement
      }
    }
  ' "${SELFHOST_ENV_FILE}" > "${tmp_file}"

  mv "${tmp_file}" "${SELFHOST_ENV_FILE}"
}

selfhost_is_placeholder() {
  local value="${1:-}"
  [[ -z "${value}" || "${value}" == "<"*">" || "${value}" == "changeme" || "${value}" == "replace-me" ]]
}

selfhost_generate_secret() {
  openssl rand -hex 32
}

selfhost_ensure_secret() {
  local key="$1"
  local current_value
  current_value="$(selfhost_read_env_value "${key}")"

  if selfhost_is_placeholder "${current_value}"; then
    selfhost_upsert_env "${key}" "$(selfhost_generate_secret)"
    printf 'Generated %s\n' "${key}"
  fi
}

selfhost_resolve_env_path() {
  local raw_path="$1"

  if [[ -z "${raw_path}" ]]; then
    return 0
  fi

  if [[ "${raw_path}" = /* ]]; then
    printf '%s\n' "${raw_path}"
    return 0
  fi

  printf '%s\n' "${SELFHOST_REPO_ROOT}/${raw_path#./}"
}

selfhost_validate_docker() {
  selfhost_require_cmd docker
  if ! docker compose version >/dev/null 2>&1; then
    printf 'docker compose is required\n' >&2
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    printf 'Docker daemon is not reachable\n' >&2
    return 1
  fi
}

selfhost_port_status() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi

  return 2
}
