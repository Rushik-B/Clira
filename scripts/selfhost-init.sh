#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./selfhost-lib.sh
source "${SCRIPT_DIR}/selfhost-lib.sh"

selfhost_print_section "Preparing self-host environment"
selfhost_validate_docker
selfhost_ensure_runtime_dir
selfhost_ensure_env_file

current_sa_path="$(selfhost_read_env_value "GOOGLE_APPLICATION_CREDENTIALS")"
if selfhost_is_placeholder "${current_sa_path}" || [[ "${current_sa_path}" == "./google-service-account.json" ]]; then
  selfhost_upsert_env "GOOGLE_APPLICATION_CREDENTIALS" "${SELFHOST_DEFAULT_SA_PATH}"
  printf 'Normalized GOOGLE_APPLICATION_CREDENTIALS to %s\n' "${SELFHOST_DEFAULT_SA_PATH}"
fi

selfhost_ensure_secret "NEXTAUTH_SECRET"
selfhost_ensure_secret "CRON_SECRET"
selfhost_ensure_secret "EMAIL_ENCRYPT_SECRET"
selfhost_ensure_secret "EMAIL_ENCRYPT_SALT"
selfhost_ensure_secret "CLIRA_DB_POSTGRES_PASSWORD"
selfhost_ensure_secret "CLIRA_DB_APP_PASSWORD"

selfhost_print_section "Running deployment checks"
if bash "${SCRIPT_DIR}/selfhost-doctor.sh"; then
  doctor_status=0
else
  doctor_status=$?
fi

service_account_path="$(selfhost_read_env_value "GOOGLE_APPLICATION_CREDENTIALS")"
service_account_abs="$(selfhost_resolve_env_path "${service_account_path}")"

selfhost_print_section "Next steps"
printf '1. Configure Google OAuth callbacks if you have not already.\n'
printf '2. Run `npm run setup:google -- --project-id <gcp-project-id> --mode pull --write-env` if Gmail Pub/Sub is not configured yet.\n'
printf '3. Start Clira with `npm run selfhost:up`.\n'
printf '4. Verify liveness at http://localhost:13000/api/health and deep readiness at http://localhost:13000/api/health?deep=1.\n'

if [[ ! -r "${service_account_abs}" ]]; then
  printf '\nService account file is not present yet at %s\n' "${service_account_abs}"
fi

if [[ "${doctor_status}" -ne 0 ]]; then
  printf '\nInitialization completed with follow-up items. Finish the steps above, then rerun `npm run selfhost:doctor`.\n'
fi
