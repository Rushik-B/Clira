# AI Providers

Clira defaults to Google Gemini-backed models. The runtime also supports OpenAI-compatible chat endpoints through the existing `openrouter` provider wiring.

## Default Google Path

```env
AI_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=your_key
```

`GOOGLE_API_KEY` is also accepted as an alias.

## OpenAI-Compatible Path

Keep `AI_PROVIDER=openrouter` and set:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Despite the env name, `OPENROUTER_BASE_URL` can point at any OpenAI-compatible endpoint, including:

- OpenRouter
- LM Studio
- vLLM gateways
- compatible local or private inference endpoints

If your compatible endpoint needs a placeholder key, set `OPENROUTER_API_KEY` to whatever that endpoint expects.

## Per-Model Overrides

Each model role can override both provider and model id:

- `FLASH_MODEL` / `FLASH_MODEL_PROVIDER`
- `PRO_MODEL` / `PRO_MODEL_PROVIDER`
- `FLASH_LITE_MODEL` / `FLASH_LITE_MODEL_PROVIDER`
- `FOLDER_GENERATION_MODEL` / `FOLDER_GENERATION_MODEL_PROVIDER`
- `EXEC_AGENT_MODEL` / `EXEC_AGENT_MODEL_PROVIDER`
- `EMAIL_RETRIEVAL_MODEL` / `EMAIL_RETRIEVAL_MODEL_PROVIDER`
- `CALENDAR_SEARCH_MODEL` / `CALENDAR_SEARCH_MODEL_PROVIDER`
- `REPLY_ROUTER_MODEL` / `REPLY_ROUTER_MODEL_PROVIDER`

## Important Notes

- Google remains the launch default because it is the known-good path across the rest of the stack.
- Health deep checks report which provider set is configured.
- Inbox-search embeddings still depend on Google-backed configuration today.
