  const textScore = (left = '', right = '') => {
  const a = new Set(String(left).toUpperCase().split(/\W+/).filter(Boolean));
  const b = new Set(String(right).toUpperCase().split(/\W+/).filter(Boolean));
  const union = new Set([...a, ...b]).size;
  return union ? [...a].filter((token) => b.has(token)).length / union : 0;
};

module.exports = { textScore };
