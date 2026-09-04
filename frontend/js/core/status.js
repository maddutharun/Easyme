export function getStatusClass(status) {
  const normalized = String(status || '').toLowerCase().replaceAll(' ', '_');
  if (['posted', 'ready_to_post', 'approved', 'auto-posted', 'auto_posted'].includes(normalized) || normalized.includes('posted') || normalized.includes('ready')) return 'parsed';
  if (['rejected', 'posting_failed', 'on_hold', 'failed', 'likely_reject'].includes(normalized) || normalized.includes('fail') || normalized.includes('reject') || normalized.includes('hold')) return 'failed';
  return 'pending';
}

export function humanizeStatus(status) {
  if (!status) return 'Pending review';
  const value = String(status).replaceAll('_', ' ').replaceAll('-', ' ');
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