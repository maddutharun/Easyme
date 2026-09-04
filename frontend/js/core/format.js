export const formatMoney = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
export const formatInr = (value) => 'Rs ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value || 0));

export function bytesToSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['Bytes', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** index;
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}