export function renderExportsPage({ appView, state, renderBreadcrumbBar }) {
  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Exports', link: null }])}
      <div class="page-header"><div><h1 class="page-title">Export Data</h1><p class="page-subtitle">Download your invoices in multiple formats for integration with ERP systems.</p></div></div>
      <div class="section-card animate-slideUp">
        <h3 style="margin-top:0; margin-bottom:20px; color: var(--heading);">Select Export Format</h3>
        <div class="exports-grid">
          <button class="export-card ${state.exportType === 'json' ? 'selected' : ''}" data-export="json" type="button"><h3>📄 JSON</h3><p>Machine-readable format with all fields and validations included</p></button>
          <button class="export-card ${state.exportType === 'csv' ? 'selected' : ''}" data-export="csv" type="button"><h3>📊 CSV</h3><p>Spreadsheet format, one row per invoice for easy analysis</p></button>
        </div>
        <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--line);"><h4 style="color: var(--heading); margin: 0 0 12px 0;">Export ${state.invoices.length} invoices as ${state.exportType.toUpperCase()}</h4><button class="primary-button export-button" type="button" style="width: 100%;">⬇️ Download Export</button></div>
      </div>
      <div class="section-card animate-slideUp" style="margin-top: 22px; animation-delay: 0.1s;"><h3 style="margin-top: 0; color: var(--heading);">💡 About Exports</h3><div style="color: var(--muted); line-height: 1.8; font-size: 0.9rem;"><p>• <strong>JSON</strong> includes complete invoice data, validation checks, AI reasoning, and ERP matching results</p><p>• <strong>CSV</strong> provides a tabular view optimized for spreadsheet applications and data analysis</p><p>• All exports include timestamp and processing metadata for audit trails</p></div></div>
    </div>`;

  appView.querySelectorAll('[data-export]').forEach((card) => card.addEventListener('click', () => {
    state.exportType = card.dataset.export;
    renderExportsPage({ appView, state, renderBreadcrumbBar });
  }));
}
