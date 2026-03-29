#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./selfhost-lib.sh
source "${SCRIPT_DIR}/selfhost-lib.sh"

fatal_issues=()
warning_issues=()
optional_notes=()

record_issue() {
  local bucket="$1"
  local message="$2"
  case "${bucket}" in
    fatal) fatal_issues+=("${message}") ;;
    warning) warning_issues+=("${message}") ;;
    optional) optional_notes+=("${message}") ;;
  esac
}

check_required_env() {
  local key="$1"
  local value
  value="$(selfhost_read_env_value "${key}")"
  if selfhost_is_placeholder "${value}"; then
    record_issue fatal "Missing required environment value: ${key}"
  fi
}

check_warning_env() {
  local key="$1"
  local value
  value="$(selfhost_read_env_value "${key}")"
  if selfhost_is_placeholder "${value}"; then
    record_issue warning "Recommended environment value is still unset: ${key}"
  fi
}

selfhost_print_section "Self-host diagnostics"

if ! selfhost_validate_docker >/dev/null 2>&1; then
  record_issue fatal "Docker and docker compose must be installed and the daemon must be running."
fi

if [[ ! -f "${SELFHOST_ENV_FILE}" ]]; then
  record_issue fatal ".env is missing. Run \`npm run selfhost:init\` first."
else
  check_required_env "CLIRA_DB_POSTGRES_PASSWORD"
  check_required_env "CLIRA_DB_APP_PASSWORD"
  check_required_env "NEXTAUTH_SECRET"
  check_required_env "CRON_SECRET"
  check_required_env "EMAIL_ENCRYPT_SECRET"
  check_required_env "EMAIL_ENCRYPT_SALT"
  check_required_env "GOOGLE_CLIENT_ID"
  check_required_env "GOOGLE_CLIENT_SECRET"
  check_required_env "GMAIL_PUBSUB_TOPIC"
  check_warning_env "APP_PUBLIC_URL"

  ingestion_mode="$(selfhost_read_env_value "GMAIL_INGESTION_MODE")"
  if [[ -z "${ingestion_mode}" ]]; then
    ingestion_mode="pull"
  fi

  if [[ "${ingestion_mode}" == "pull" ]]; then
    check_required_env "GMAIL_PUBSUB_PULL_SUBSCRIPTION"
  fi

  ai_provider="$(selfhost_read_env_value "AI_PROVIDER")"
  if [[ -z "${ai_provider}" ]]; then
    ai_provider="google"
  fi

  case "${ai_provider}" in
    google)
      google_key="$(selfhost_read_env_value "GOOGLE_GENERATIVE_AI_API_KEY")"
      google_alias_key="$(selfhost_read_env_value "GOOGLE_API_KEY")"
      if selfhost_is_placeholder "${google_key}" && selfhost_is_placeholder "${google_alias_key}"; then
        record_issue fatal "AI provider is google but neither GOOGLE_GENERATIVE_AI_API_KEY nor GOOGLE_API_KEY is configured."
      fi
      ;;
    openrouter)
      if selfhost_is_placeholder "$(selfhost_read_env_value "OPENROUTER_API_KEY")"; then
        record_issue fatal "AI provider is openrouter but OPENROUTER_API_KEY is missing."
      fi
      if ! selfhost_is_placeholder "$(selfhost_read_env_value "OPENROUTER_BASE_URL")"; then
        optional_notes+=("OPENROUTER_BASE_URL is set. This can point at any OpenAI-compatible endpoint, not just OpenRouter.")
      fi
      ;;
    *)
      record_issue warning "Unsupported AI_PROVIDER value in .env: ${ai_provider}"
      ;;
  esac

  service_account_path="$(selfhost_read_env_value "GOOGLE_APPLICATION_CREDENTIALS")"
  if selfhost_is_placeholder "${service_account_path}"; then
    record_issue fatal "GOOGLE_APPLICATION_CREDENTIALS is missing."
  else
    service_account_abs="$(selfhost_resolve_env_path "${service_account_path}")"
    if [[ ! -r "${service_account_abs}" ]]; then
      record_issue fatal "Google service account file is not readable at ${service_account_abs}. Run \`npm run setup:google -- --project-id <id> --mode pull --write-env\`."
    fi
  fi
fi

for port in 13000; do
  if selfhost_port_status "${port}"; then
    record_issue warning "Port ${port} is already in use. Docker self-host defaults may conflict."
  else
    port_status=$?
    if [[ "${port_status}" -eq 2 ]]; then
      record_issue optional "Could not inspect port ${port} because lsof is unavailable."
    fi
  fi
done

optional_notes+=("Cron is part of the required launch topology. The cron container calls internal /api/cron/* routes and should stay enabled in self-host deployments.")

if (( ${#fatal_issues[@]} > 0 )); then
  printf '\nFatal issues:\n'
  for issue in "${fatal_issues[@]}"; do
    printf '  - %s\n' "${issue}"
  done
fi

if (( ${#warning_issues[@]} > 0 )); then
  printf '\nWarnings:\n'
  for issue in "${warning_issues[@]}"; do
    printf '  - %s\n' "${issue}"
  done
fi

if (( ${#optional_notes[@]} > 0 )); then
  printf '\nNotes:\n'
  for note in "${optional_notes[@]}"; do
    printf '  - %s\n' "${note}"
  done
fi

if (( ${#fatal_issues[@]} == 0 )); then
  printf '\nSelf-host diagnostics passed.\n'
  exit 0
fi

printf '\nSelf-host diagnostics found %d fatal issue(s).\n' "${#fatal_issues[@]}"
exit 1
