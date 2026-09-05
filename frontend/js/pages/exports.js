import { apiFetch } from '../core/api.js';

export function renderExportsPage({ appView, state, renderBreadcrumbBar }) {
  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Exports', link: null }])}
      <div class="page-header"><div><h1 class="page-title">Exports</h1><p class="page-subtitle">Download the current invoice set for ERP or analysis.</p></div></div>
      <div class="section-card">
        <div class="exports-grid">
          <button class="export-card ${state.exportType === 'json' ? 'selected' : ''}" data-export="json" type="button"><h3>JSON</h3><p>Full records, checks, and recommendations</p></button>
          <button class="export-card ${state.exportType === 'csv' ? 'selected' : ''}" data-export="csv" type="button"><h3>CSV</h3><p>One row per invoice</p></button>
        </div>
        <div style="margin-top: 28px; display:flex; gap:12px; flex-wrap:wrap;">
          <button class="primary-button export-button" type="button">Download ${state.invoices.length} invoices</button>
          <button class="secondary-button" id="exportAuditButton" type="button">Download audit CSV</button>
        </div>
      </div>
    </div>`;

  appView.querySelectorAll('[data-export]').forEach((card) => card.addEventListener('click', () => {
    state.exportType = card.dataset.export;
    renderExportsPage({ appView, state, renderBreadcrumbBar });
  }));

  appView.querySelector('#exportAuditButton')?.addEventListener('click', async () => {
    const response = await apiFetch('/api/exports/audit');
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'easyme-audit.csv';
    link.click();
    URL.revokeObjectURL(url);
  });
}
