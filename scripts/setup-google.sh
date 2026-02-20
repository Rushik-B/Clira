#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID=""
DOMAIN=""
TOPIC_NAME="clira-email-updates"
SUB_NAME="clira-gmail-sub"
SERVICE_ACCOUNT_NAME="clira-gmail-sa"
KEY_OUT="./google-service-account.json"

usage() {
  cat <<USAGE
Usage:
  scripts/setup-google.sh --project-id <gcp-project-id> --domain <public-domain>

Optional:
  --topic <topic-name>             (default: clira-email-updates)
  --subscription <subscription>    (default: clira-gmail-sub)
  --service-account <name>         (default: clira-gmail-sa)
  --key-out <path>                 (default: ./google-service-account.json)

Notes:
  - Requires authenticated gcloud CLI.
  - Creates Pub/Sub topic + push subscription.
  - Grants Gmail push publisher permission.
  - Creates service account and JSON key.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --topic) TOPIC_NAME="$2"; shift 2 ;;
    --subscription) SUB_NAME="$2"; shift 2 ;;
    --service-account) SERVICE_ACCOUNT_NAME="$2"; shift 2 ;;
    --key-out) KEY_OUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$PROJECT_ID" || -z "$DOMAIN" ]]; then
  usage
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required"
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null

echo "Enabling APIs..."
gcloud services enable gmail.googleapis.com pubsub.googleapis.com iam.googleapis.com >/dev/null

echo "Creating topic (idempotent)..."
gcloud pubsub topics create "$TOPIC_NAME" --project "$PROJECT_ID" >/dev/null 2>&1 || true

echo "Creating push subscription (idempotent)..."
gcloud pubsub subscriptions create "$SUB_NAME" \
  --topic "$TOPIC_NAME" \
  --push-endpoint "https://${DOMAIN}/api/gmail-push/webhook" \
  --project "$PROJECT_ID" >/dev/null 2>&1 || true

echo "Granting Gmail API publisher role..."
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project "$PROJECT_ID" >/dev/null

SA_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Creating service account (idempotent)..."
gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
  --display-name="Clira Gmail Push Service Account" >/dev/null 2>&1 || true

echo "Granting Pub/Sub roles to service account..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/pubsub.subscriber" >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/pubsub.viewer" >/dev/null

echo "Creating service account key..."
gcloud iam service-accounts keys create "$KEY_OUT" \
  --iam-account "$SA_EMAIL" >/dev/null

cat <<ENV_OUT

Setup complete.
Use these env vars:

GMAIL_PUBSUB_TOPIC=projects/${PROJECT_ID}/topics/${TOPIC_NAME}
GOOGLE_CLOUD_PROJECT_ID=${PROJECT_ID}
GOOGLE_APPLICATION_CREDENTIALS=$(cd "$(dirname "$KEY_OUT")" && pwd)/$(basename "$KEY_OUT")

Webhook endpoint configured:
https://${DOMAIN}/api/gmail-push/webhook
ENV_OUT
