  const calculateConfidence = ({ extraction = 0, vendor = 0, twoWay = 0, historical = 0, accounting = 0 }) => Math.round((
  extraction * 0.20 + vendor * 0.20 + twoWay * 0.25 + historical * 0.25 + accounting * 0.10
) * 100) / 100;

const decide = (confidence, hardStops = []) => {
  if (hardStops.length) return { action: 'REVIEW', reason: 'HARD_STOP', autoPost: false };
  if (confidence >= 95) return { action: 'APPROVAL_REQUIRED', reason: 'HIGH_CONFIDENCE', autoPost: false };
  if (confidence >= 80) return { action: 'REVIEW', reason: 'MEDIUM_CONFIDENCE', autoPost: false };
  return { action: 'REJECT_OR_QUERY', reason: 'LOW_CONFIDENCE', autoPost: false };
};

module.exports = { calculateConfidence, decide };
