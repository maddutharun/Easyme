  const { matchingPolicy } = require('../../config/app-config');

function decideAutoPost({
  enabled = false,
  extracted = {},
  comparison = {},
  duplicate = false,
  vendor = null,
  lineMatch = null,
  templateStable = false,
  amount = 0
} = {}) {
  const blockers = [];
  if (!enabled) blockers.push('AUTO_POST_DISABLED');
  if (!templateStable) blockers.push('VENDOR_TEMPLATE_NOT_STABLE');
  if (!vendor) blockers.push('VENDOR_NOT_ON_MASTER');
  if (duplicate) blockers.push('DUPLICATE');
  if (extracted.readable === false) blockers.push('UNREADABLE');
  if (extracted.arithmeticValidation && extracted.arithmeticValidation.passed === false) blockers.push('ARITHMETIC');
  if (Number(comparison.confidence || 0) < matchingPolicy.minimumAutoPostConfidence) blockers.push('CONFIDENCE');
  if (Number(amount || 0) >= matchingPolicy.highValueReviewAmount) blockers.push('HIGH_VALUE');
  if (comparison.checks?.some((check) => check.severity === 'critical' && !check.passed)) blockers.push('HARD_STOP');
  if (lineMatch && lineMatch.passed === false) blockers.push('LINE_MATCH');
  const eligible = blockers.length === 0;
  return {
    eligible,
    autoPosted: false,
    blockers,
    summary: eligible
      ? 'Eligible for auto-post on a calibrated vendor slice. Posting still requires the Post action unless AUTO_POST_EXECUTE is enabled.'
      : `Not eligible: ${blockers.join(', ')}`
  };
}

module.exports = { decideAutoPost };
