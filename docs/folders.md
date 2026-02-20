# Folders And Routing

Clira's folder system organizes inbound email into user-specific routing buckets.

## What It Does

- Generates initial folder candidates during onboarding
- Maps sender/domain patterns to folder labels
- Learns from user corrections over time
- Supports review-first behavior for uncertain classifications

## Core Components

- Services: `src/lib/services/onboarding-services/`
- APIs: `src/app/api/folders/*`, `src/app/api/onboarding/*`
- Worker queues:
  - `folder-generation`
  - `email-mapping`
  - `email-learning`
  - `email-categorization`
  - `fast-onboarding-proposal`

## Data Model

- `Label` - folder/label definition
- `EmailMapping` - sender/domain/subject mapping rules
- `EmailLearning` - user correction history
- `EmailSort` + `BatchSortJob` - operational sort outcomes

## Runtime Flow

1. Onboarding generates candidate folders
2. User reviews and confirms folders
3. Background jobs generate mapping rules
4. Incoming emails are filtered and routed
5. User corrections feed learning jobs

## Operational Tips

- Keep `FEATURE_FLAG_FOLDER_MANAGEMENT=true` to expose management UI
- Use `POST /api/folders/sort-now` for on-demand sorting
- Monitor batch sort jobs and mapping job failures in worker logs
