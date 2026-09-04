export function getStatusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('parsed') || normalized.includes('posted') || normalized.includes('ready')) return 'parsed';
  if (normalized.includes('pending') || normalized.includes('review') || normalized.includes('query')) return 'pending';
  if (normalized.includes('failed') || normalized.includes('on hold') || normalized.includes('reject')) return 'failed';
  return 'pending';
}

export function humanizeStatus(status) {
  if (!status) return 'Pending';
  const value = String(status).replaceAll('_', ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function getStepColor(status) {
  if (status === 'completed') return '#4ad39d';
  if (status === 'warning') return '#f3b370';
  return '#9aa9bd';
}

export function getStatusBadgeClass(status) {
  if (status === 'completed') return 'parsed';
  if (status === 'warning') return 'warning';
  return 'pending';
}