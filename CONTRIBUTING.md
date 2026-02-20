# Contributing

Thanks for contributing to Clira.

## Principles

- Keep changes scoped and reviewable
- Preserve type safety (avoid `any` unless justified)
- Never commit secrets or real user email data
- Prefer deterministic behavior over hidden fallback logic

## Local Development Flow

1. `npm install`
2. `cp .env.example .env` and configure
3. `docker compose up -d db redis`
4. `npm run migrate:deploy`
5. Run app: `npm run dev`
6. Run worker: `npm run start:worker`

## Quality Checks

- Lint: `npm run lint`
- Tests: `npm test`
- Optional benchmark pass for prompt/pipeline changes: `npm run benchmark`

## Pull Request Expectations

- Clear problem statement and proposed fix
- Validation steps with expected results
- Updated docs for behavior/configuration changes
- Notes for migrations, env changes, or operational impact
