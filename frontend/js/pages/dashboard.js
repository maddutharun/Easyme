export function renderDashboardPage({ appView, state, renderBreadcrumbBar, formatMoney, getStatusClass, humanizeStatus }) {
  const metrics = {
    total: state.metrics?.total ?? state.invoices.length,
    posted: state.metrics?.posted ?? state.invoices.filter((invoice) => String(invoice.status || '').includes('posted')).length,
    exceptions: state.metrics?.exceptions ?? state.invoices.filter((invoice) => invoice.isException).length,
    avgConfidence: state.metrics?.averageConfidence ?? (state.invoices.length ? (state.invoices.reduce((sum, invoice) => sum + (invoice.confidence ?? 0), 0) / state.invoices.length).toFixed(1) : 0)
  };
  const statusCounts = {
    posted: state.invoices.filter((invoice) => String(invoice.status || '').includes('posted')).length,
    review: state.invoices.filter((invoice) => String(invoice.status || '').includes('review') || invoice.status === 'query_open').length,
    rejected: state.invoices.filter((invoice) => String(invoice.status || '').includes('reject')).length,
    hold: state.invoices.filter((invoice) => String(invoice.status || '').includes('hold')).length
  };
  const maxStatusValue = Math.max(...Object.values(statusCounts), 1);
  const auditItems = (state.audit || []).slice(0, 5);

  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Dashboard', link: null }])}
      <div class="page-header"><div><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Live extraction, matching, and ERP posting metrics.</p></div></div>
      <div class="dashboard-stats">
        <div class="stat-box animate-slideUp"><div class="stat-label">Total invoices</div><div class="stat-value">${metrics.total}</div></div>
        <div class="stat-box animate-slideUp"><div class="stat-label">Posted to ERP</div><div class="stat-value">${metrics.posted}</div></div>
        <div class="stat-box animate-slideUp"><div class="stat-label">Exception queue</div><div class="stat-value">${metrics.exceptions}</div></div>
        <div class="stat-box animate-slideUp"><div class="stat-label">Avg confidence</div><div class="stat-value">${metrics.avgConfidence}%</div></div>
      </div>
      <div class="dashboard-actions"><div class="action-card"><div class="action-icon">📤</div><div class="action-label">Upload Invoice</div></div><div class="action-card"><div class="action-icon">👁️</div><div class="action-label">View Pending Reviews</div></div><div class="action-card"><div class="action-icon">📊</div><div class="action-label">Export Summary</div></div></div>
      <div class="widget-grid">
        <div class="section-card animate-slideUp"><h3>Processing mix</h3><div class="chart-bars">${Object.entries(statusCounts).map(([label, count]) => `<div class="chart-row"><div class="chart-label">${label}</div><div class="chart-bar-track"><div class="chart-bar ${label}" style="width: ${(count / maxStatusValue) * 100}%"></div></div><div class="chart-value">${count}</div></div>`).join('')}</div></div>
        <div class="section-card animate-slideUp"><h3>Audit trail</h3><div class="timeline">${auditItems.length ? auditItems.map((entry) => `<div class="timeline-item"><div class="timeline-marker"></div><div class="timeline-content"><div class="timeline-time">${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''}</div><div class="timeline-title">${entry.action || 'Event'}</div><div class="timeline-description">${entry.detail || entry.reason || ''}</div></div></div>`).join('') : '<div class="empty-state-text">No audit events yet</div>'}</div></div>
      </div>
      <div class="section-card animate-slideUp" style="margin-top: 24px;"><h3>Recent activity</h3>${state.invoices.slice(0, 5).map((invoice) => `<div class="list-item"><div style="display: flex; justify-content: space-between; align-items: center;"><div><div style="font-weight: 600; color: var(--heading);">${invoice.vendor || 'Unknown'}</div><div style="color: var(--muted); font-size: 0.85rem;">${invoice.invoiceNumber || 'N/A'} • ${invoice.date || 'N/A'}</div></div><div style="text-align: right;"><div style="font-weight: 600; color: var(--heading);">${formatMoney(invoice.amount || 0)}</div><span class="badge ${getStatusClass(invoice.status)}">${humanizeStatus(invoice.status)}</span></div></div></div>`).join('')}</div>
    </div>`;
}
