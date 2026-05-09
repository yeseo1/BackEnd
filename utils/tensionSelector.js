const BASE_TENSION_WEIGHTS = {
  FACT_CONFLICT: 1.0,
  UNADDRESSED_NEEDS: 0.9,
  EMOTION_NEED_GAP: 0.85,
  INTERPRETATION_GAP: 0.8,
  PERSPECTIVE_GAP: 0.75,
  LABEL_MISMATCH: 0.65,
};

function averageSimilarity(evidence = []) {
  const similarityValues = evidence
    .map((item) => item.similarity)
    .filter((value) => typeof value === "number");

  if (!similarityValues.length) {
    return 0;
  }

  return (
    similarityValues.reduce((sum, value) => sum + value, 0) / similarityValues.length
  );
}

function scoreTensionCandidate(candidate) {
  const baseWeight = BASE_TENSION_WEIGHTS[candidate.type] || 0.5;
  const evidenceCount = candidate.evidence?.length || 0;
  const similarityBoost = averageSimilarity(candidate.evidence) * 0.2;

  return Number((baseWeight + evidenceCount * 0.05 + similarityBoost).toFixed(4));
}

export function selectKeyTensions(candidates, { limit = 3 } = {}) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return [];
  }

  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      score: scoreTensionCandidate(candidate),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
