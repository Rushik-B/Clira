#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID=""
MODE="pull"
DOMAIN=""
TOPIC_NAME="clira-email-updates"
SUB_NAME="clira-gmail-pull-sub"
SERVICE_ACCOUNT_NAME="clira-gmail-sa"
KEY_OUT="./google-service-account.json"
DLQ_TOPIC_NAME=""
DLQ_SUB_NAME=""
MAX_DELIVERY_ATTEMPTS="20"

RETRY_MIN="10s"
RETRY_MAX="600s"

usage() {
  cat <<USAGE
Usage:
  scripts/setup-google.sh --project-id <gcp-project-id> [--mode pull|push] [options]

Modes:
  pull (default): creates pull subscription + DLQ (no public webhook required)
  push: creates push subscription (requires --domain)

Options:
  --project-id <id>               GCP project id (required)
  --mode <pull|push>              Ingestion mode (default: pull)
  --domain <public-domain>        Required only when --mode push
  --topic <topic-name>            Pub/Sub topic (default: clira-email-updates)
  --subscription <name>           Subscription name (default: clira-gmail-pull-sub)
  --service-account <name>        Service account name (default: clira-gmail-sa)
  --key-out <path>                Service account key output (default: ./google-service-account.json)
  --dlq-topic <name>              DLQ topic name for pull mode (default: <subscription>-dlq)
  --dlq-subscription <name>       DLQ subscription name for pull mode (default: <dlq-topic>-sub)
  --max-delivery-attempts <n>     DLQ max delivery attempts for pull mode (default: 20)
  -h, --help                      Show this help

Notes:
  - Requires authenticated gcloud CLI.
  - Applies retry policy (min=${RETRY_MIN}, max=${RETRY_MAX}) on created subscription.
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required"
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --topic) TOPIC_NAME="$2"; shift 2 ;;
    --subscription) SUB_NAME="$2"; shift 2 ;;
    --service-account) SERVICE_ACCOUNT_NAME="$2"; shift 2 ;;
    --key-out) KEY_OUT="$2"; shift 2 ;;
    --dlq-topic) DLQ_TOPIC_NAME="$2"; shift 2 ;;
    --dlq-subscription) DLQ_SUB_NAME="$2"; shift 2 ;;
    --max-delivery-attempts) MAX_DELIVERY_ATTEMPTS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$PROJECT_ID" ]]; then
  usage
  exit 1
fi

MODE="$(echo "$MODE" | tr '[:upper:]' '[:lower:]')"
if [[ "$MODE" != "pull" && "$MODE" != "push" ]]; then
  echo "Invalid --mode: $MODE (expected pull or push)"
  exit 1
fi

if [[ "$MODE" == "push" && -z "$DOMAIN" ]]; then
  echo "--domain is required when --mode push"
  exit 1
fi

if ! [[ "$MAX_DELIVERY_ATTEMPTS" =~ ^[0-9]+$ ]] || [[ "$MAX_DELIVERY_ATTEMPTS" -lt 5 ]]; then
  echo "--max-delivery-attempts must be an integer >= 5"
  exit 1
fi

if [[ -z "$DLQ_TOPIC_NAME" ]]; then
  DLQ_TOPIC_NAME="${SUB_NAME}-dlq"
fi
if [[ -z "$DLQ_SUB_NAME" ]]; then
  DLQ_SUB_NAME="${DLQ_TOPIC_NAME}-sub"
fi

require_cmd gcloud

echo "Setting gcloud project..."
gcloud config set project "$PROJECT_ID" >/dev/null

echo "Enabling APIs..."
gcloud services enable gmail.googleapis.com pubsub.googleapis.com iam.googleapis.com >/dev/null

echo "Creating primary Pub/Sub topic (idempotent)..."
gcloud pubsub topics create "$TOPIC_NAME" --project "$PROJECT_ID" >/dev/null 2>&1 || true

echo "Granting Gmail API publisher role on primary topic..."
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project "$PROJECT_ID" >/dev/null

SA_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Creating service account (idempotent)..."
gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
  --display-name="Clira Gmail Ingestion Service Account" >/dev/null 2>&1 || true

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

if [[ "$MODE" == "pull" ]]; then
  echo "Creating DLQ topic/subscription for pull mode (idempotent)..."
  gcloud pubsub topics create "$DLQ_TOPIC_NAME" --project "$PROJECT_ID" >/dev/null 2>&1 || true
  gcloud pubsub subscriptions create "$DLQ_SUB_NAME" \
    --topic "$DLQ_TOPIC_NAME" \
    --project "$PROJECT_ID" >/dev/null 2>&1 || true

  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  PUBSUB_SERVICE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"

  echo "Granting Pub/Sub service agent publisher role on DLQ topic..."
  gcloud pubsub topics add-iam-policy-binding "$DLQ_TOPIC_NAME" \
    --member="serviceAccount:${PUBSUB_SERVICE_AGENT}" \
    --role="roles/pubsub.publisher" \
    --project "$PROJECT_ID" >/dev/null

  echo "Creating pull subscription (idempotent)..."
  gcloud pubsub subscriptions create "$SUB_NAME" \
    --topic "$TOPIC_NAME" \
    --project "$PROJECT_ID" \
    --min-retry-delay "$RETRY_MIN" \
    --max-retry-delay "$RETRY_MAX" \
    --dead-letter-topic "$DLQ_TOPIC_NAME" \
    --max-delivery-attempts "$MAX_DELIVERY_ATTEMPTS" >/dev/null 2>&1 || true

  echo "Updating pull subscription retry + DLQ policy..."
  gcloud pubsub subscriptions update "$SUB_NAME" \
    --project "$PROJECT_ID" \
    --min-retry-delay "$RETRY_MIN" \
    --max-retry-delay "$RETRY_MAX" \
    --dead-letter-topic "$DLQ_TOPIC_NAME" \
    --max-delivery-attempts "$MAX_DELIVERY_ATTEMPTS" >/dev/null
else
  echo "Creating push subscription (idempotent)..."
  gcloud pubsub subscriptions create "$SUB_NAME" \
    --topic "$TOPIC_NAME" \
    --push-endpoint "https://${DOMAIN}/api/gmail-push/webhook" \
    --project "$PROJECT_ID" \
    --min-retry-delay "$RETRY_MIN" \
    --max-retry-delay "$RETRY_MAX" >/dev/null 2>&1 || true

  echo "Updating push subscription endpoint + retry policy..."
  gcloud pubsub subscriptions update "$SUB_NAME" \
    --project "$PROJECT_ID" \
    --push-endpoint "https://${DOMAIN}/api/gmail-push/webhook" \
    --min-retry-delay "$RETRY_MIN" \
    --max-retry-delay "$RETRY_MAX" >/dev/null
fi

ABS_KEY_OUT="$(cd "$(dirname "$KEY_OUT")" && pwd)/$(basename "$KEY_OUT")"

cat <<ENV_OUT

Setup complete.
Use these env vars:

GMAIL_INGESTION_MODE=${MODE}
GMAIL_PUBSUB_TOPIC=projects/${PROJECT_ID}/topics/${TOPIC_NAME}
GMAIL_PUBSUB_PULL_SUBSCRIPTION=projects/${PROJECT_ID}/subscriptions/${SUB_NAME}
GMAIL_PUBSUB_PULL_MAX_MESSAGES=25
GMAIL_PUBSUB_PULL_MAX_BYTES=10485760
GMAIL_PUBSUB_PULL_SHUTDOWN_TIMEOUT_MS=15000
GOOGLE_CLOUD_PROJECT_ID=${PROJECT_ID}
GOOGLE_APPLICATION_CREDENTIALS=${ABS_KEY_OUT}
ENV_OUT

if [[ "$MODE" == "push" ]]; then
  cat <<PUSH_OUT

Push webhook endpoint configured:
https://${DOMAIN}/api/gmail-push/webhook
PUSH_OUT
else
  cat <<PULL_OUT

Pull mode configured:
- Primary subscription: projects/${PROJECT_ID}/subscriptions/${SUB_NAME}
- Dead-letter topic: projects/${PROJECT_ID}/topics/${DLQ_TOPIC_NAME}
- Dead-letter subscription: projects/${PROJECT_ID}/subscriptions/${DLQ_SUB_NAME}
PULL_OUT
fi
