# MasterPrompt System

MasterPrompt is Clira's user voice profile used in reply styling.

## Purpose

- Capture tone and communication preferences from user history
- Keep generated replies consistent with user writing style
- Separate factual planning from stylistic rewrite

## Where It Is Used

- Planner stage builds factual/structured plan
- Style stage applies MasterPrompt and style examples
- Style stage is constrained to avoid introducing new facts

Key files:

- `src/lib/ml/masterPromptGenerator.ts`
- `src/lib/services/core/replyGenerator.ts`
- `src/lib/ai/agents/styleAgent.ts`

## Generation Lifecycle

- Initial generation happens during onboarding jobs
- Additional generation endpoints exist under `/api/master-prompt/*`
- Background regeneration endpoint exists for quality refresh workflows

## API Surface

- `/api/master-prompt/route.ts`
- `/api/master-prompt/generate/route.ts`
- `/api/master-prompt/auto-generate/route.ts`
- `/api/master-prompt/ensure/route.ts`
- `/api/master-prompt/activate/route.ts`
- `/api/master-prompt/history/route.ts`

## Failure Behavior

If style generation fails, Clira falls back to planner draft output in non-strict mode to keep user workflow functional.
