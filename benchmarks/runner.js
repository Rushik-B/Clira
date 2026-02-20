#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { scoreScenario } = require('./evaluators/heuristics');

function loadScenarios() {
  const scenariosDir = path.join(__dirname, 'scenarios');
  if (!fs.existsSync(scenariosDir)) return [];

  const files = fs
    .readdirSync(scenariosDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(scenariosDir, name));

  const scenarios = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) scenarios.push(...parsed);
  }
  return scenarios;
}

function fakePipelineResponse(scenario) {
  const thread = Array.isArray(scenario.emailThread) ? scenario.emailThread.join('\n') : '';
  return `Thanks for the follow up.\n\nBased on the thread, we can confirm the existing terms.\n\n${thread}`;
}

function fakeSinglePassResponse() {
  return 'Thanks for the note. We can offer a new 20% discount and flexible terms.';
}

function run() {
  const scenarios = loadScenarios();
  if (scenarios.length === 0) {
    console.log('No benchmark scenarios found in benchmarks/scenarios.');
    process.exit(0);
  }

  const pipelineResults = scenarios.map((scenario) => {
    const reply = fakePipelineResponse(scenario);
    return scoreScenario(reply, scenario);
  });

  const singlePassResults = scenarios.map((scenario) => {
    const reply = fakeSinglePassResponse(scenario);
    return scoreScenario(reply, scenario);
  });

  const summarize = (results) => {
    const passed = results.filter((r) => r.passed).length;
    return {
      total: results.length,
      passed,
      passRate: `${((passed / results.length) * 100).toFixed(1)}%`,
    };
  };

  const pipelineSummary = summarize(pipelineResults);
  const singleSummary = summarize(singlePassResults);

  console.log('Benchmark summary');
  console.log('-----------------');
  console.log('Pipeline:', pipelineSummary);
  console.log('Single-pass baseline:', singleSummary);
}

run();
