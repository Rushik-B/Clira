# Benchmarking

Clira includes a benchmark scaffold for comparing pipeline quality and behavior.

## Run Benchmarks

```bash
npm run benchmark
```

The runner checks for:

- The active language-model provider envs described in `docs/ai-providers.md`
- Explicit model ids if you are benchmarking OpenRouter or a mixed-provider configuration

## Benchmark Assets

- Runner: `benchmarks/runner.js`
- Evaluators: `benchmarks/evaluators/heuristics.js`
- Example scenario: `benchmarks/scenarios/sample.json`

## Suggested Evaluation Dimensions

- Hallucination/commitment rate
- Context retention quality
- Style consistency
- Determinism across repeated runs

## Practical Workflow

1. Add or modify scenarios under `benchmarks/scenarios`
2. Run benchmarks against current branch
3. Compare output before and after prompt/logic changes
4. Capture deltas in PR descriptions
