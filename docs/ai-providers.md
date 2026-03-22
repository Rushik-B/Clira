# AI Providers

Clira's language-model layer is provider-aware. The current defaults preserve the existing Gemini setup, but you can switch the whole app or individual model roles to OpenRouter through environment variables.

## Default Behavior

- `AI_PROVIDER=google` is the default.
- `GOOGLE_GENERATIVE_AI_API_KEY` or `GOOGLE_API_KEY` continues to authenticate Gemini-backed calls.
- Existing role-level model env vars still work and keep their previous defaults.
- `USE_LITE_MODEL=true` still forces the flash/pro default to the lighter Gemini variant used for test and low-cost flows.

## OpenRouter Setup

- Set `AI_PROVIDER=openrouter`.
- Set `OPENROUTER_API_KEY`.
- Optional transport and attribution env vars: `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_X_TITLE`, `OPENROUTER_SUPPORTS_STRUCTURED_OUTPUTS`.

## Per-Model Overrides

Each role can be overridden independently, and per-model provider settings take precedence over the global `AI_PROVIDER`:

- `FLASH_MODEL` / `FLASH_MODEL_PROVIDER`
- `PRO_MODEL` / `PRO_MODEL_PROVIDER`
- `FLASH_LITE_MODEL` / `FLASH_LITE_MODEL_PROVIDER`
- `FOLDER_GENERATION_MODEL` / `FOLDER_GENERATION_MODEL_PROVIDER`
- `EXEC_AGENT_MODEL` / `EXEC_AGENT_MODEL_PROVIDER`
- `EMAIL_RETRIEVAL_MODEL` / `EMAIL_RETRIEVAL_MODEL_PROVIDER`
- `CALENDAR_SEARCH_MODEL` / `CALENDAR_SEARCH_MODEL_PROVIDER`
- `REPLY_ROUTER_MODEL` / `REPLY_ROUTER_MODEL_PROVIDER`

## Behavior Notes

- Google-specific `thinkingConfig` hints are only applied when the active provider is Google.
- Health checks report the configured provider set so runtime mismatches are visible.
- Inbox-search embeddings are still Google-backed for now and still require Google credentials.

