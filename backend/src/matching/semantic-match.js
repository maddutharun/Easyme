  const semanticMatch = (embedding, candidates = []) => candidates
  .map((candidate) => ({ ...candidate, semanticScore: Number(candidate.semanticScore || 0) }))
  .sort((left, right) => right.semanticScore - left.semanticScore)
  .slice(0, 20);

module.exports = { semanticMatch };
