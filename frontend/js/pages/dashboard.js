export function renderDashboardPage({ appView, state, renderBreadcrumbBar, formatMoney, getStatusClass, humanizeStatus }) {
  const metrics = {
    total: state.invoices.length,
    posted: state.invoices.filter((invoice) => !['failed', 'on hold'].includes(String(invoice.status || '').toLowerCase())).length,
    failed: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('failed')).length,
    avgConfidence: state.invoices.length ? (state.invoices.reduce((sum, invoice) => sum + (invoice.confidence ?? 0), 0) / state.invoices.length).toFixed(1) : 0
  };
  const statusCounts = {
    posted: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('posted')).length,
    review: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('review')).length,
    failed: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('failed')).length,
    hold: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('hold')).length
  };
  const maxStatusValue = Math.max(...Object.values(statusCounts), 1);

  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Dashboard', link: null }])}
      <div class="page-header"><div><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Real-time metrics on invoice extraction and ERP processing status.</p></div></div>
      <div class="dashboard-stats">
        <div class="stat-box animate-slideUp"><div class="stat-label">📦 Total Invoices</div><div class="stat-value">${metrics.total}</div></div>
        <div class="stat-box animate-slideUp"><div class="stat-label">✅ Successfully Posted</div><div class="stat-value">${metrics.posted}</div></div>
        <div class="stat-box animate-slideUp"><div class="stat-label">❌ Failed/On Hold</div><div class="stat-value">${metrics.failed}</div></div>
        <div class="stat-box animate-slideUp"><div class="stat-label">📊 Avg Confidence</div><div class="stat-value">${metrics.avgConfidence}%</div></div>
      </div>
      <div class="dashboard-actions"><div class="action-card"><div class="action-icon">📤</div><div class="action-label">Upload Invoice</div></div><div class="action-card"><div class="action-icon">👁️</div><div class="action-label">View Pending Reviews</div></div><div class="action-card"><div class="action-icon">📊</div><div class="action-label">Export Summary</div></div></div>
      <div class="widget-grid">
        <div class="section-card animate-slideUp"><h3>📊 Processing Mix</h3><div class="chart-bars">${Object.entries(statusCounts).map(([label, count]) => `<div class="chart-row"><div class="chart-label">${label}</div><div class="chart-bar-track"><div class="chart-bar ${label}" style="width: ${(count / maxStatusValue) * 100}%"></div></div><div class="chart-value">${count}</div></div>`).join('')}</div></div>
        <div class="section-card animate-slideUp"><h3>📜 Audit Trail</h3><div class="timeline"><div class="timeline-item"><div class="timeline-marker"></div><div class="timeline-content"><div class="timeline-time">Today • 09:40</div><div class="timeline-title">Invoice scanned and validated</div><div class="timeline-description">Vendor, PO, and GST fields matched against ERP context</div></div></div><div class="timeline-item"><div class="timeline-marker"></div><div class="timeline-content"><div class="timeline-time">Today • 10:15</div><div class="timeline-title">Review queue updated</div><div class="timeline-description">2 invoices flagged for tax variance and manual approval</div></div></div></div></div>
      </div>
      <div class="section-card animate-slideUp" style="margin-top: 24px;"><h3>📈 Recent Activity</h3>${state.invoices.slice(0, 5).map((invoice) => `<div class="list-item"><div style="display: flex; justify-content: space-between; align-items: center;"><div><div style="font-weight: 600; color: var(--heading);">${invoice.vendor || 'Unknown'}</div><div style="color: var(--muted); font-size: 0.85rem;">${invoice.invoiceNumber || 'N/A'} • ${invoice.date || 'N/A'}</div></div><div style="text-align: right;"><div style="font-weight: 600; color: var(--heading);">${formatMoney(invoice.amount || 0)}</div><span class="badge ${getStatusClass(invoice.status)}">${humanizeStatus(invoice.status)}</span></div></div></div>`).join('')}</div>
    </div>`;
}
