import { apiFetch, canPerform, getUser } from '../core/api.js';
import { getStatusClass, getStepColor, humanizeStatus } from '../core/status.js';
import { formatInr, formatMoney } from '../core/format.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function paperDocument(invoice, currencyFormatter) {
  return `
    <article class="paper-doc" aria-label="Invoice facsimile">
      <div class="paper-doc-mark">Tax invoice</div>
      <h2>${escapeHtml(invoice.vendor || 'Unknown vendor')}</h2>
      <div class="paper-doc-grid">
        <div><span>Invoice</span><strong>${escapeHtml(invoice.invoiceNumber || 'N/A')}</strong></div>
        <div><span>Date</span><strong>${escapeHtml(invoice.date || 'N/A')}</strong></div>
        <div><span>PO</span><strong>${escapeHtml(invoice.po || 'N/A')}</strong></div>
        <div><span>HSN</span><strong>${escapeHtml(invoice.hsnCode || 'N/A')}</strong></div>
        <div><span>Tax</span><strong>${currencyFormatter(invoice.tax || 0)}</strong></div>
        <div><span>Total</span><strong>${currencyFormatter(invoice.amount || 0)}</strong></div>
      </div>
      <p style="margin-top:24px;color:#64748b;font-size:0.85rem;">${escapeHtml(invoice.description || invoice.issue || 'Fields reconstructed from extraction.')}</p>
    </article>
  `;
}

function decisionTone(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('posted')) return 'posted';
  if (value.includes('fail') || value.includes('reject') || value.includes('hold')) return 'failed';
  return 'needs-review';
}

export function renderInvoiceDetailPage({ appView, invoice, state, renderBreadcrumbBar, renderView, showToast, showPremiumModal, initExportPreview, refreshChrome }) {
  if (!invoice) {
    appView.innerHTML = `<div class="page-shell"><div class="empty-state"><div class="empty-state-title">No invoice selected</div><div class="empty-state-text">Choose an invoice from Exceptions or Invoices.</div></div></div>`;
    return;
  }

  const statusText = invoice.status || 'pending_review';
  const statusClass = getStatusClass(statusText);
  const confidence = Number(invoice.confidence ?? 0);
  const currencyFormatter = invoice.currency === 'INR' ? formatInr : formatMoney;
  const checks = invoice.checks || [];
  const failed = checks.filter((check) => !check.passed);
  const workflow = Array.isArray(invoice.workflow) ? invoice.workflow : [];
  const erpDoc = invoice.posting?.erpDocumentNumber || invoice.erpDocument;
  const why = invoice.issue || invoice.aiSummary || (failed[0]?.detail) || 'Ready for reviewer judgement.';

  const reviewFieldsByGroup = {
    Supplier: [['vendor', 'Vendor'], ['supplierGstin', 'GSTIN'], ['supplierPan', 'PAN']],
    Invoice: [['invoiceNumber', 'Invoice #'], ['date', 'Date'], ['po', 'PO'], ['hsnCode', 'HSN']],
    Amounts: [['amount', 'Total'], ['tax', 'Tax'], ['baseAmount', 'Taxable']]
  };

  const reviewForm = Object.entries(reviewFieldsByGroup).map(([groupTitle, fields]) => `
    <div class="review-field-group">
      <h4 class="review-group-title">${groupTitle}</h4>
      ${fields.map(([key, label]) => {
        const isNumeric = ['amount', 'tax', 'baseAmount'].includes(key);
        return `<div class="review-field-row"><span>${label}</span><input data-edit-field="${key}" value="${escapeHtml(invoice[key] ?? '')}" ${isNumeric ? 'inputmode="decimal"' : ''} /></div>`;
      }).join('')}
    </div>
  `).join('');

  appView.innerHTML = `
    <div class="page-shell">
      ${renderBreadcrumbBar([{ label: 'Queue', link: 'exceptions' }, { label: invoice.invoiceNumber || invoice.id, link: null }])}
      <div class="detail-header">
        <button class="back-link" id="backToInvoices" type="button">Back</button>
        <div class="detail-actions">
          <span class="status-badge ${statusClass}">${humanizeStatus(statusText)}</span>
          ${canPerform('query') ? '<button class="secondary-button" id="queryInvoiceButton" type="button">Query vendor</button>' : ''}
          ${canPerform('hold') ? '<button class="secondary-button" id="holdInvoiceButton" type="button">Hold</button>' : ''}
          ${canPerform('reject') ? '<button class="secondary-button" id="rejectInvoiceButton" type="button">Reject</button>' : ''}
          ${canPerform('approve') ? '<button class="secondary-button" id="approveInvoiceButton" type="button">Approve</button>' : ''}
          ${canPerform('post') ? '<button class="primary-button" id="postInvoiceButton" type="button">Post to ERP</button>' : ''}
        </div>
      </div>

      <div class="decision-banner ${decisionTone(statusText)}">
        <div>
          <strong>${escapeHtml(invoice.vendor || 'Unknown vendor')}</strong>
          <p style="margin:6px 0 0; color: var(--heading);">${escapeHtml(why)}</p>
          <div class="confidence-meter" title="Match confidence ${confidence}%"><span style="width:${Math.max(0, Math.min(100, confidence))}%"></span></div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.2rem; font-weight:700;">${currencyFormatter(invoice.amount || 0)}</div>
          <div style="color:var(--muted); font-size:0.8rem;">${confidence}% confidence</div>
        </div>
      </div>
      ${erpDoc ? `<div class="erp-receipt">ERP document ${escapeHtml(erpDoc)}${invoice.reconciliation ? ` · reconciled ${invoice.reconciliation.reconciled ? 'yes' : 'no'}` : ''}</div>` : ''}

      <div class="review-workspace">
        <div>
          ${invoice.storagePath || invoice.fileName
            ? '<iframe class="document-preview" title="Invoice document" src="about:blank"></iframe>'
            : paperDocument(invoice, currencyFormatter)}
        </div>
        <div class="section-card">
          <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
            <h3 style="margin:0;">Fields and matching</h3>
            <div>
            ${['ap_manager', 'finance_approver', 'admin'].includes(getUser()?.role) ? '<button class="ghost-button" id="recommendButton" type="button">Re-score</button>' : ''}
              <button class="primary-button" id="saveReviewButton" type="button">Save corrections</button>
            </div>
          </div>
          <div class="review-group-container">${reviewForm}</div>
          <h4 style="margin: 20px 0 8px;">ERP checks</h4>
          <div class="check-list">
            ${checks.length ? checks.map((check) => `<div class="check-row"><div><strong>${escapeHtml(check.name)}</strong><div style="color:var(--muted);font-size:0.82rem;">${escapeHtml(check.detail || '')}</div></div><span class="badge ${check.passed ? 'badge-success' : 'badge-danger'}">${check.passed ? 'Pass' : 'Fail'}</span></div>`).join('') : '<div class="empty-state-text">Checks appear after matching.</div>'}
          </div>
          ${invoice.aiSummary ? `<p style="margin-top:16px; color: var(--heading);">${escapeHtml(invoice.aiSummary)}</p>` : ''}
          ${canPerform('approve') ? `
            <form id="feedbackForm" style="margin-top:16px; display:grid; gap:8px;">
              <label>GL / cost center correction
                <input name="correctedGl" placeholder="GL account" />
              </label>
              <input name="correctedCostCenter" placeholder="Cost center" />
              <button class="secondary-button" type="submit">Save accounting feedback</button>
            </form>
          ` : ''}
        </div>
      </div>

      ${workflow.length ? `<div class="section-card" style="margin-top:20px;"><h3>Workflow</h3>${workflow.map((step) => `<div class="workflow-step" style="--step-color:${getStepColor(step.status)};"><div class="workflow-step-number">${step.step}</div><div><div class="workflow-step-title">${escapeHtml(step.title)}</div><div class="workflow-step-detail">${escapeHtml(step.detail)}</div></div><div class="workflow-step-status">${escapeHtml(step.status)}</div></div>`).join('')}</div>` : ''}
    </div>
  `;

  const applyUpdated = (updated) => {
    const index = state.invoices.findIndex((item) => item.id === updated.id);
    if (index >= 0) state.invoices[index] = updated;
    state.selectedInvoiceId = updated.id;
    renderInvoiceDetailPage({ appView, invoice: updated, state, renderBreadcrumbBar, renderView, showToast, showPremiumModal, initExportPreview, refreshChrome });
    refreshChrome();
  };

  const runAction = async (action, extra = {}) => {
    const response = await apiFetch(`/api/invoices/${invoice.id}/action`, { method: 'POST', body: JSON.stringify({ action, ...extra }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `${action} failed`);
    applyUpdated(data.invoice);
    showToast(humanizeStatus(data.invoice.status), 'success');
    if (action === 'post' && data.invoice.posting?.erpDocumentNumber) {
      const recon = await apiFetch(`/api/invoices/${invoice.id}/reconciliation`);
      if (recon.ok) {
        const payload = await recon.json();
        applyUpdated({ ...data.invoice, reconciliation: payload });
      }
    }
  };

  document.getElementById('backToInvoices').addEventListener('click', () => {
    state.currentView = 'exceptions';
    renderView();
  });

  document.getElementById('saveReviewButton')?.addEventListener('click', async () => {
    const payload = {};
    document.querySelectorAll('[data-edit-field]').forEach((input) => {
      const raw = input.value.trim();
      payload[input.dataset.editField] = ['amount', 'tax', 'baseAmount'].includes(input.dataset.editField) ? Number(raw) : raw;
    });
    const response = await apiFetch(`/api/invoices/${invoice.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) return showToast(data.error || 'Save failed', 'error');
    applyUpdated(data.invoice);
    showToast('Corrections saved', 'success');
  });

  document.getElementById('approveInvoiceButton')?.addEventListener('click', () => runAction('approve').catch((error) => showToast(error.message, 'error')));
  document.getElementById('postInvoiceButton')?.addEventListener('click', () => runAction('post').catch((error) => showToast(error.message, 'error')));
  document.getElementById('holdInvoiceButton')?.addEventListener('click', () => runAction('hold').catch((error) => showToast(error.message, 'error')));
  document.getElementById('rejectInvoiceButton')?.addEventListener('click', () => runAction('reject', { reason: 'Rejected in review workspace' }).catch((error) => showToast(error.message, 'error')));
  document.getElementById('queryInvoiceButton')?.addEventListener('click', () => runAction('query').catch((error) => showToast(error.message, 'error')));

  document.getElementById('recommendButton')?.addEventListener('click', async () => {
    const response = await apiFetch(`/api/invoices/${invoice.id}/recommendation`, { method: 'POST', body: '{}' });
    const data = await response.json();
    if (!response.ok) return showToast(data.error || 'Re-score failed', 'error');
    applyUpdated(data.invoice || invoice);
    showToast('Recommendation refreshed', 'success');
  });

  document.getElementById('feedbackForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await apiFetch(`/api/invoices/${invoice.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({
        correctedGl: form.get('correctedGl'),
        correctedCostCenter: form.get('correctedCostCenter'),
        reason: 'Reviewer accounting correction'
      })
    });
    const data = await response.json();
    if (!response.ok) return showToast(data.error || 'Feedback failed', 'error');
    showToast('Accounting feedback recorded', 'success');
  });

  if (invoice.storagePath || invoice.fileName) {
    apiFetch(`/api/invoices/${invoice.id}/file`).then(async (response) => {
      if (!response.ok) return;
      const frame = document.querySelector('.document-preview');
      if (frame) frame.src = URL.createObjectURL(await response.blob());
    }).catch(() => {});
  }
}
