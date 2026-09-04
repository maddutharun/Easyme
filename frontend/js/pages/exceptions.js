import { getStatusClass, humanizeStatus } from '../core/status.js';

export function renderExceptionsPage({ appView, state, renderBreadcrumbBar, formatMoney }) {
  const exceptions = (state.invoices || []).filter((invoice) => invoice.isException || ['pending_review', 'on_hold', 'rejected', 'query_open', 'posting_failed'].includes(String(invoice.status || '').toLowerCase()));

  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Exceptions', link: null }])}
      <div class="page-header">
        <div>
          <h1 class="page-title">Exception queue</h1>
          <p class="page-subtitle">Invoices that need a human decision before ERP posting.</p>
        </div>
      </div>
      <div class="section-card">
        ${exceptions.length ? exceptions.map((invoice) => `
          <button class="list-item exception-row" data-invoice-id="${invoice.id}" type="button">
            <div style="display:flex; justify-content:space-between; gap:12px; width:100%;">
              <div>
                <div style="font-weight:600; color: var(--heading);">${invoice.vendor || 'Unknown vendor'}</div>
                <div style="color: var(--muted); font-size: 0.85rem;">${invoice.invoiceNumber || 'N/A'} • ${invoice.issue || 'Needs review'}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-weight:600;">${formatMoney(invoice.amount || 0)}</div>
                <span class="badge ${getStatusClass(invoice.status)}">${humanizeStatus(invoice.status)}</span>
              </div>
            </div>
          </button>
        `).join('') : `<div class="empty-state"><div class="empty-state-title">No exceptions</div><div class="empty-state-text">Auto-post and review gates are clear.</div></div>`}
      </div>
    </div>
  `;

  appView.querySelectorAll('.exception-row').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedInvoiceId = row.dataset.invoiceId;
      state.currentView = 'invoice-detail';
      window.dispatchEvent(new CustomEvent('easyme:navigate'));
    });
  });
}
