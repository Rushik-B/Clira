function containsAny(haystack, needles) {
  return needles.some((needle) => haystack.toLowerCase().includes(String(needle).toLowerCase()));
}

function containsNone(haystack, needles) {
  return needles.every((needle) => !haystack.toLowerCase().includes(String(needle).toLowerCase()));
}

function scoreScenario(responseText, scenario) {
  const mustMention = scenario?.expected?.mustMention ?? [];
  const mustNotInvent = scenario?.expected?.mustNotInvent ?? [];

  const mentionPass = mustMention.length === 0 ? true : containsAny(responseText, mustMention);
  const inventPass = mustNotInvent.length === 0 ? true : containsNone(responseText, mustNotInvent);

  return {
    id: scenario.id,
    mentionPass,
    inventPass,
    passed: mentionPass && inventPass,
  };
}

module.exports = {
  scoreScenario,
};
