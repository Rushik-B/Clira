#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GOOGLE_GENERATIVE_AI_API_KEY:-}" && -z "${GOOGLE_API_KEY:-}" ]]; then
  echo "Set GOOGLE_GENERATIVE_AI_API_KEY (or GOOGLE_API_KEY) before running benchmarks."
  exit 1
fi

node benchmarks/runner.js
