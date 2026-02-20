# Security

Clira is built for self-hosted operation with explicit security boundaries around credentials, webhooks, and automation routes.

## Security Model

- Draft-first workflow with deterministic filtering before LLM generation
- Separation of factual planning and stylistic rewrite
- Optional KMS-backed encryption for OAuth tokens and email content
- Signature verification for external webhook providers
- Secret-gated cron endpoints

## Credential And Data Handling

- OAuth secrets are encrypted using AES-256-GCM materials in `src/lib/security/tokenCrypto.ts`
- Data keys can be generated/decrypted via KMS (`src/lib/security/dataKeyManager.ts`)
- Encrypted key metadata is tracked in Prisma `EncryptionKey`
- Email content models support ciphertext fields for sensitive payloads

## Webhook Protection

- Twilio: validates `X-Twilio-Signature`
- WhatsApp Cloud API: validates `X-Hub-Signature-256`
- Gmail Pub/Sub webhook acknowledges quickly and processes asynchronously

## Cron Route Protection

Cron routes require:

```text
Authorization: Bearer <CRON_SECRET>
```

Do not expose cron endpoints publicly without auth.

## Deployment Hardening Checklist

- Set strong random `NEXTAUTH_SECRET` and `CRON_SECRET`
- Run over HTTPS for all webhook and auth callbacks
- Restrict cloud IAM roles to minimum required permissions
- Rotate API keys and service account keys regularly
- Keep dependencies and Prisma migrations reviewed and up to date
- Monitor app and worker logs for auth/signature failures

## Vulnerability Reporting

Follow `SECURITY.md` at repository root for reporting process.
