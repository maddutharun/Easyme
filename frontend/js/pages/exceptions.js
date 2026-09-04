import { getStatusClass, humanizeStatus } from '../core/status.js';

function failedChecks(invoice) {
  return (invoice.checks || []).filter((check) => !check.passed).map((check) => check.name);
}

export function renderExceptionsPage({ appView, state, renderBreadcrumbBar, formatMoney }) {
  const exceptions = (state.invoices || []).filter((invoice) => invoice.isException || ['pending_review', 'on_hold', 'rejected', 'query_open', 'posting_failed'].includes(String(invoice.status || '').toLowerCase()));

  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Exceptions', link: null }])}
      <div class="page-header">
        <div>
          <h1 class="page-title">Exception queue</h1>
          <p class="page-subtitle">Invoices blocked from posting. Open a row to correct fields and decide. Press J / K to move, Enter to open.</p>
        </div>
      </div>
      <div class="worklist">
        ${exceptions.length ? exceptions.map((invoice) => {
          const blockers = failedChecks(invoice);
          const reason = invoice.issue || (blockers.length ? blockers.slice(0, 2).join(' · ') : 'Needs review');
          const money = invoice.currency === 'INR' ? null : formatMoney;
          const amount = money ? money(invoice.amount || 0) : `Rs ${Number(invoice.amount || 0).toLocaleString('en-IN')}`;
          return `
            <button class="worklist-row" data-invoice-id="${invoice.id}" type="button">
              <div>
                <strong>${invoice.vendor || 'Unknown vendor'}</strong>
                <div style="color: var(--muted); font-size: 0.85rem; margin-top: 4px;">${invoice.invoiceNumber || 'N/A'} · ${reason}</div>
              </div>
              <div>${amount}</div>
              <div>${invoice.confidence ?? 0}% confidence</div>
              <span class="badge ${getStatusClass(invoice.status)}">${humanizeStatus(invoice.status)}</span>
            </button>
          `;
        }).join('') : `<div class="empty-state"><div class="empty-state-title">Queue is clear</div><div class="empty-state-text">Nothing needs a human decision. New uploads land here when matching fails a hard gate.</div></div>`}
      </div>
    </div>
  `;

  appView.querySelectorAll('.worklist-row').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedInvoiceId = row.dataset.invoiceId;
      state.currentView = 'invoice-detail';
      window.dispatchEvent(new CustomEvent('easyme:navigate'));
    });
  });

  const rows = [...appView.querySelectorAll('.worklist-row')];
  const keyHandler = (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    const current = rows.findIndex((row) => row.dataset.invoiceId === state.selectedInvoiceId);
    if (event.key === 'j' || event.key === 'ArrowDown') {
      const next = rows[Math.min(rows.length - 1, current + 1)] || rows[0];
      next?.focus();
      state.selectedInvoiceId = next?.dataset.invoiceId;
    }
    if (event.key === 'k' || event.key === 'ArrowUp') {
      const prev = rows[Math.max(0, current - 1)] || rows[0];
      prev?.focus();
      state.selectedInvoiceId = prev?.dataset.invoiceId;
    }
    if (event.key === 'Enter' && state.selectedInvoiceId) {
      state.currentView = 'invoice-detail';
      window.dispatchEvent(new CustomEvent('easyme:navigate'));
    }
  };
  appView.addEventListener('keydown', keyHandler);
}
