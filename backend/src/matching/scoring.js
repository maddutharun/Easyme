  const scoreHistoricalMatch = ({ amount = 0, description = 0, currency = 0, po = 0 }) => Math.round((
  amount * 0.35 + description * 0.25 + currency * 0.10 + po * 0.30
) * 10000) / 100;

module.exports = { scoreHistoricalMatch };
