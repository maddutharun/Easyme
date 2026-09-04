import { state } from './core/state.js';
import { bytesToSize, formatInr, formatMoney } from './core/format.js';
import { getStatusBadgeClass, getStatusClass, getStepColor, humanizeStatus } from './core/status.js';
import { renderBreadcrumb } from './core/dom.js';
import { showToast } from './core/toast.js';
import { renderDashboardPage as renderDashboardModule } from './pages/dashboard.js';
import { renderExportsPage as renderExportsModule } from './pages/exports.js';
import { renderWorkflowPage as renderWorkflowModule } from './pages/workflow.js';
import { renderExceptionsPage } from './pages/exceptions.js';
import {
  setupThemeToggle,
  showToastNotification,
  addTooltips,
  enableKeyboardShortcuts,
  enableSidebarCollapse,
  initExportPreview,
  addStatusBadgeAnimations
} from './enhancements.js';
import { apiFetch, getToken, getUser, setSession, clearSession, canPerform } from './core/api.js';

const appView = document.getElementById('appView');

function renderBreadcrumbBar(items) {
  return `<div class="breadcrumb">${renderBreadcrumb(items)}</div>`;
}

function getEmptyStateText() {
  return state.searchQuery ? 'Try adjusting your search' : 'Start by uploading an invoice';
}

function renderNav() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.currentView);
  });
}

function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  document.body.classList.toggle('dark-mode', state.darkMode);
  localStorage.setItem('darkMode', state.darkMode);
}

function pushHistory() {
  const snapshot = JSON.stringify(state.invoices.map((invoice) => ({ ...invoice })));
  state.history.push(snapshot);
  if (state.history.length > 25) state.history.shift();
  state.redoStack = [];
}

function undoLastAction() {
  if (!state.history.length) {
    showToast('Nothing to undo', 'warning');
    return;
  }

  const previous = JSON.parse(state.history.pop());
  state.redoStack.push(JSON.stringify(state.invoices.map((invoice) => ({ ...invoice }))));
  state.invoices = previous;
  showToast('Action undone', 'warning');
  renderView();
}

function redoLastAction() {
  if (!state.redoStack.length) {
    showToast('Nothing to redo', 'warning');
    return;
  }

  const next = JSON.parse(state.redoStack.pop());
  state.history.push(JSON.stringify(state.invoices.map((invoice) => ({ ...invoice }))));
  state.invoices = next;
  showToast('Action restored', 'success');
  renderView();
}

function toggleSidebarCollapse() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.querySelector('.sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch(e.key.toLowerCase()) {
      case 'u': state.currentView = 'upload'; renderView(); break;
      case 'd': state.currentView = 'dashboard'; renderView(); break;
      case 'i': state.currentView = 'invoices'; renderView(); break;
      case 'w': state.currentView = 'workflow'; renderView(); break;
      case 'e': state.currentView = 'exports'; renderView(); break;
      case 'z': if (state.history.length) undoLastAction(); break;
      case 'y': if (state.redoStack.length) redoLastAction(); break;
      case 'escape': if (state.currentView === 'invoice-detail') { state.currentView = 'invoices'; renderView(); } break;
    }
  });
}

async function loadInvoices() {
  try {
    const [summaryResponse, auditResponse, metricsResponse] = await Promise.all([
      apiFetch('/api/summary'),
      apiFetch('/api/audit'),
      apiFetch('/api/metrics')
    ]);
    if (summaryResponse.status === 401) return;
    const summary = await summaryResponse.json();
    const auditPayload = auditResponse.ok ? await auditResponse.json() : { audit: [] };
    const metricsPayload = metricsResponse.ok ? await metricsResponse.json() : { metrics: {} };
    state.invoices = [...(summary.invoices || [])].sort((a, b) => new Date(b.date || '1970-01-01') - new Date(a.date || '1970-01-01'));
    state.audit = auditPayload.audit || [];
    state.metrics = metricsPayload.metrics || summary.metrics || {};
    refreshChrome();
    if (!state.selectedInvoiceId && state.invoices.length) state.selectedInvoiceId = state.invoices[0].id;
    renderView();
  } catch (error) {
    console.error(error);
    showToast('Failed to load invoices', 'error');
  }
}

function validateSelectedFile(file) {
  if (!file) {
    return { valid: false, message: 'No invoice file selected.' };
  }

  const allowedExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'xlsx', 'xls'];
  const ext = String(file.name || '').split('.').pop()?.toLowerCase();

  if (!allowedExtensions.includes(ext)) {
    return { valid: false, message: 'Unsupported file type. Please upload PDF, PNG, JPG, TIFF, XLSX, or XLS.' };
  }

  if (file.size > 100 * 1024 * 1024) {
    return { valid: false, message: 'File is too large. Please keep each invoice under 100 MB.' };
  }

  return { valid: true };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function renderUploadPage() {
  const selectedFile = state.activeFile;
  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Upload', link: null }])}
      
      <div class="page-header">
        <div>
          <h1 class="page-title">Upload Invoice</h1>
          <p class="page-subtitle">PDF, JPG, PNG, or Excel files. Advanced OCR extraction with ERP validation.</p>
        </div>
      </div>

      <div class="upload-card">
        <label class="dropzone" for="uploadInput">
          <div class="dropzone-inner">
            <div class="upload-icon">📄</div>
            <p class="upload-copy">Drop invoices here or <strong>click to browse</strong></p>
            <p class="upload-help">PDF, PNG, JPG, TIFF — up to 100 MB per file</p>
          </div>
        </label>
        <input id="uploadInput" class="file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.tiff" />
      </div>

      ${selectedFile ? `
        <div class="file-card animate-slideUp" style="animation-delay: 0.1s;">
          <div class="file-meta">
            <div class="file-icon">${selectedFile.name.split('.').pop().toUpperCase()}</div>
            <div>
              <div class="file-name">${selectedFile.name}</div>
              <div class="file-size">${bytesToSize(selectedFile.size)}</div>
            </div>
          </div>
          <span class="duplicate-badge">Ready to process</span>
        </div>

        <div class="file-footer">
          <span>1 file selected</span>
          <button type="button" class="clear-link" id="clearUpload">Clear all</button>
        </div>
      ` : ''}

      <div style="margin-top: 28px; display:flex; justify-content:center; gap:16px;">
        <button class="primary-button" id="processButton" ${selectedFile ? '' : 'disabled'}>Process Invoice</button>
        <button class="secondary-button" id="cancelButton">Cancel</button>
      </div>

      <div id="uploadStatus" class="upload-status" aria-live="polite"></div>

      <div class="section-card animate-slideUp" style="margin-top: 28px;">
        <h3 style="margin: 0 0 12px 0; color: var(--heading);">💡 Supported File Formats</h3>
        <p style="margin: 0; color: var(--muted); font-size: 0.9rem;">
          <strong>PDF:</strong> Native PDFs with selectable text. 
          <strong>Images:</strong> PNG, JPG, TIFF with automatic OCR fallback. 
          <strong>Excel:</strong> XLSX and XLS files with structured data.
        </p>
      </div>
    </div>
  `;

  const uploadInput = document.getElementById('uploadInput');
  uploadInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0] || null;
    state.activeFile = file;
    renderUploadPage();
  });

  document.getElementById('clearUpload')?.addEventListener('click', () => {
    state.activeFile = null;
    uploadInput.value = '';
    renderUploadPage();
  });

  document.getElementById('cancelButton').addEventListener('click', () => {
    state.activeFile = null;
    uploadInput.value = '';
    renderUploadPage();
  });

  document.getElementById('processButton').addEventListener('click', async () => {
    if (!state.activeFile) return;

    const validation = validateSelectedFile(state.activeFile);
    const statusEl = document.getElementById('uploadStatus');

    if (!validation.valid) {
      statusEl.className = 'upload-status error';
      statusEl.textContent = '❌ ' + validation.message;
      return;
    }

    const formData = new FormData();
    formData.append('invoice', state.activeFile);

    statusEl.className = 'upload-status info';
    statusEl.textContent = '⏳ Processing invoice...';

    try {
      const response = await fetchWithTimeout('/api/invoices/upload', {
        method: 'POST',
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
        body: formData
      }, 25000);

      let data = {};
      try {
        data = await response.json();
      } catch (jsonError) {
        data = {};
      }

      if (!response.ok) {
        const serverMessage = data?.error || 'Upload failed';
        throw new Error(serverMessage);
      }

      state.selectedInvoiceId = data.invoice.id;
      state.currentView = 'invoices';
      await loadInvoices();
      state.currentView = 'invoice-detail';
      renderInvoiceDetailPage(data.invoice);
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Upload timed out. The server may be busy or unreachable.'
        : !navigator.onLine
          ? 'Network is offline. Please reconnect and retry.'
          : error?.message?.includes('Failed to fetch') || error?.message?.includes('fetch')
            ? 'Server is not reachable. Start the app with npm start and retry.'
            : error?.message || 'Unable to parse the uploaded invoice.';

      statusEl.className = 'upload-status error';
      statusEl.textContent = '❌ ' + message;
    }
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderInvoiceDetailPage(invoice) {
  if (!invoice) {
    appView.innerHTML = `<div class="page-shell"><div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">No invoice selected</div>
      <div class="empty-state-text">Select an invoice from the list to view details</div>
    </div></div>`;
    return;
  }

  const statusText = invoice.status || 'pending';
  const statusClass = getStatusClass(statusText);
  const confidence = invoice.confidence ?? 90;
  const currencyFormatter = invoice.currency === 'INR' ? formatInr : formatMoney;
  const pipelineStages = invoice.pipeline?.stages || [];
  const checks = invoice.checks || [];
  const workflow = Array.isArray(invoice.workflow) && invoice.workflow.length ? invoice.workflow : [
    { step: 1, title: 'Invoice Ingestion', status: 'completed', detail: 'Invoice received and queued.' },
    { step: 2, title: 'Data Extraction', status: 'completed', detail: 'Fields extracted and validated.' },
    { step: 3, title: 'Vendor & PO Resolution', status: 'completed', detail: 'Vendor/PO reasoning complete.' },
    { step: 4, title: 'ERP Record Pull', status: 'completed', detail: 'ERP records retrieved for matching.' },
    { step: 5, title: 'Matching Engine', status: 'completed', detail: 'Quantity, rate, tax, and TDS checks executed.' },
    { step: 6, title: 'AI Reasoning', status: 'completed', detail: 'Summary generated.' },
    { step: 7, title: 'Decision Routing', status: 'warning', detail: 'Review decision issued.' },
    { step: 8, title: 'Approval Action', status: 'pending', detail: 'Approval pending.' },
    { step: 9, title: 'Posting to ERP', status: 'pending', detail: 'Waiting for final approval.' },
    { step: 10, title: 'Post-Posting Reconciliation', status: 'pending', detail: 'Reconciliation pending.' }
  ];

  const reviewFieldsByGroup = {
    'Supplier Information': [
      ['vendor', 'Vendor Name'],
      ['supplierName', 'Supplier Name'],
      ['supplierGstin', 'Supplier GSTIN'],
      ['supplierPan', 'Supplier PAN'],
      ['supplierState', 'Supplier State'],
      ['supplierAddress', 'Supplier Address']
    ],
    'Invoice Details': [
      ['invoiceNumber', 'Invoice #'],
      ['date', 'Invoice Date'],
      ['po', 'PO Number'],
      ['hsnCode', 'HSN/SAC'],
      ['shipToDetails', 'Ship To Details']
    ],
    'Amount & Tax': [
      ['amount', 'Total Amount'],
      ['baseAmount', 'Base Amount'],
      ['tax', 'Tax / GST'],
      ['taxAmount', 'Tax Amount'],
      ['totalAmount', 'Final Total']
    ],
    'Compliance & Signature': [
      ['sealPresent', 'Seal Present'],
      ['signaturePresent', 'Signature Present']
    ]
  };

  const reviewForm = Object.entries(reviewFieldsByGroup).map(([groupTitle, fields]) => {
    const groupFields = fields.map(([key, label]) => {
      const value = invoice[key] ?? '';
      const isBoolean = key === 'signaturePresent' || key === 'sealPresent';
      const isNumeric = ['amount', 'tax', 'baseAmount', 'taxAmount', 'totalAmount'].includes(key);
      const inputType = isBoolean ? 'checkbox' : 'text';
      const checked = isBoolean ? Boolean(value) : '';
      const textValue = isBoolean ? '' : escapeHtml(value);
      const numericInput = isNumeric ? `inputmode="numeric"` : '';

      return `
        <div class="review-field-row">
          <span>${label}</span>
          ${isBoolean ? `
            <label>
              <input type="checkbox" data-edit-field="${key}" ${checked ? 'checked' : ''} />
              <span>${value ? 'Yes' : 'No'}</span>
            </label>
          ` : `
            <input
              type="${inputType}"
              data-edit-field="${key}"
              value="${textValue}"
              ${numericInput}
              placeholder="Enter ${label.toLowerCase()}"
            />
          `}
        </div>
      `;
    }).join('');

    return `
      <div class="review-field-group">
        <h4 class="review-group-title">${groupTitle}</h4>
        ${groupFields}
      </div>
    `;
  }).join('');

  const reviewContainer = `<div class="review-group-container">${reviewForm}</div>`;

  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Invoices', link: 'invoices' }, { label: invoice.invoiceNumber, link: null }])}
      
      <div class="detail-header">
        <button class="back-link" id="backToInvoices">← Back to invoices</button>
        <div class="detail-actions">
          <span class="status-badge ${statusClass} ${statusText.toLowerCase().includes('pending') ? 'pending' : ''}">${humanizeStatus(statusText)}</span>
          <button class="secondary-button" id="editInvoiceButton">Edit</button>
          ${canPerform('hold') ? '<button class="secondary-button" id="holdInvoiceButton">Hold</button>' : ''}
          ${canPerform('reject') ? '<button class="secondary-button" id="rejectInvoiceButton">Reject</button>' : ''}
          ${canPerform('approve') ? `<button class="primary-button" id="approveInvoiceButton">${canPerform('post') ? 'Approve & Post' : 'Approve'}</button>` : ''}
          <button class="ghost-button" id="exportInvoiceButton">Export</button>
        </div>
      </div>

      <div class="result-panel animate-slideUp">
        <div class="result-header">
          <div>
            <div class="company-name">${invoice.vendor || 'Unknown vendor'}</div>
            <div class="invoice-meta-line">Invoice #${invoice.invoiceNumber || 'N/A'}</div>
          </div>
          <span class="status-badge parsed">✓ Parsed Successfully</span>
        </div>

        <div class="metric-grid">
          <div class="metric">
            <span class="metric-label">📅 Issue Date</span>
            <span class="metric-value">${invoice.date || 'N/A'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">💰 Amount</span>
            <span class="metric-value">${currencyFormatter(invoice.amount || 0)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">📊 Confidence <span class="tooltip" data-tooltip="OCR/Extraction accuracy"><span class="tooltip-icon">?</span></span></span>
            <span class="metric-value">${confidence}%</span>
          </div>
        </div>

        <div class="total-box">
          <span>Total Due</span>
          <strong>${currencyFormatter(invoice.amount || 0)}</strong>
        </div>
      </div>

      ${invoice.storagePath || invoice.fileName ? `
        <div class="section-card animate-slideUp" style="margin-top: 22px;">
          <h3 style="margin: 0 0 12px 0; color: var(--heading);">Source document</h3>
          <iframe class="document-preview" title="Invoice document" src="about:blank"></iframe>
        </div>
      ` : ''}

      <div class="section-card animate-slideUp" style="margin-top: 22px; animation-delay: 0.1s;">
        <h3 style="margin: 0 0 18px 0; color: var(--heading);">📋 Extracted Details</h3>
        <div class="field-row"><span>Vendor</span><strong>${invoice.vendor || 'N/A'}</strong></div>
        <div class="field-row"><span>Invoice #</span><strong>${invoice.invoiceNumber || 'N/A'}</strong></div>
        <div class="field-row"><span>PO Number</span><strong>${invoice.po || 'N/A'}</strong></div>
        <div class="field-row"><span>Date</span><strong>${invoice.date || 'N/A'}</strong></div>
        <div class="field-row"><span>Amount</span><strong>${currencyFormatter(invoice.amount || 0)}</strong></div>
        <div class="field-row"><span>Tax/GST</span><strong>${currencyFormatter(invoice.tax || 0)}</strong></div>
        <div class="field-row"><span>Currency</span><strong>${invoice.currency || 'USD'}</strong></div>
        <div class="field-row"><span>HSN/SAC</span><strong>${invoice.hsnCode || 'N/A'}</strong></div>
        <div class="field-row"><span>Description</span><strong>${invoice.description || 'N/A'}</strong></div>
      </div>

      <div class="section-card animate-slideUp" style="margin-top: 22px; animation-delay: 0.15s;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
          <h3 style="margin: 0; color: var(--heading);">🧾 Review & Correct Extracted Fields</h3>
          <button class="primary-button" id="saveReviewButton" type="button">Save review</button>
        </div>
        ${reviewForm}
      </div>

      <div class="section-card animate-slideUp" style="margin-top: 22px; animation-delay: 0.15s;">
        <h3 style="margin: 0 0 18px 0; color: var(--heading);">⚙️ ERP Validation Checks</h3>
        ${checks.length ? checks.map((check, i) => `
          <div class="list-item" style="animation-delay: ${0.2 + i * 0.05}s;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 600; color: var(--heading);">${check.name}</div>
                <div style="color: var(--muted); font-size: 0.85rem; margin-top: 4px;">${check.detail}</div>
              </div>
              <span class="badge ${check.passed ? 'badge-success' : 'badge-danger'}">${check.passed ? '✓ Pass' : '✗ Fail'}</span>
            </div>
          </div>
        `).join('') : '<div style="color: var(--muted);">No checks available</div>'}
      </div>

      <div class="section-card animate-slideUp" style="margin-top: 22px; animation-delay: 0.2s;">
        <h3 style="margin: 0 0 18px 0; color: var(--heading);">🔍 AI Reasoning</h3>
        ${invoice.aiSummary ? `<div style="color: var(--heading); line-height: 1.6;">${invoice.aiSummary}</div>` : '<div style="color: var(--muted);">No AI reasoning available</div>'}
      </div>

      <div class="section-card animate-slideUp" style="margin-top: 22px; animation-delay: 0.25s;">
        <h3 style="margin: 0 0 18px 0; color: var(--heading);">📘 Workflow Timeline</h3>
        <div style="display: grid; gap: 12px;">
          ${workflow.map((step) => {
            const stepColor = getStepColor(step.status);
            return `
              <div style="display:grid; grid-template-columns: 32px 1fr 120px; gap: 12px; align-items: start; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.02); border-left: 3px solid ${stepColor};">
                <div style="font-weight:700; color: var(--heading);">${step.step}</div>
                <div>
                  <div style="font-weight:600; color: var(--heading); margin-bottom: 4px;">${step.title}</div>
                  <div style="color: var(--muted); font-size: 0.85rem; line-height: 1.5;">${step.detail}</div>
                </div>
                <div style="justify-self:end; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: ${stepColor}; font-weight:700;">${step.status}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      ${pipelineStages.length ? `
        <div class="section-card animate-slideUp" style="margin-top: 22px; animation-delay: 0.3s;">
          <h3 style="margin: 0 0 18px 0; color: var(--heading);">🔄 Processing Pipeline</h3>
          <div style="display: grid; gap: 12px;">
            ${pipelineStages.map((stage) => {
              const stageColor = getStepColor(stage.status);
              const badgeClass = getStatusBadgeClass(stage.status);
              return `
                <div style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: rgba(255,255,255,0.01); border-radius: 8px; border-left: 3px solid ${stageColor};">
                  <span style="color: var(--muted); font-size: 0.85rem; text-transform: uppercase; font-weight: 600; min-width: 140px;">${stage.stage.replaceAll('_', ' ')}</span>
                  <span class="status-badge ${badgeClass}">${stage.status}</span>
                  <span style="color: var(--muted); font-size: 0.85rem;">${stage.detail}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('backToInvoices').addEventListener('click', () => {
    state.currentView = 'invoices';
    renderView();
  });

  document.getElementById('saveReviewButton')?.addEventListener('click', async () => {
    const payload = {};
    document.querySelectorAll('[data-edit-field]').forEach((input) => {
      const field = input.dataset.editField;
      if (input.type === 'checkbox') {
        payload[field] = input.checked;
        return;
      }
      const raw = input.value.trim();
      if (raw === '') {
        payload[field] = null;
        return;
      }
      payload[field] = ['amount', 'tax', 'baseAmount', 'taxAmount', 'totalAmount'].includes(field) ? Number(raw) : raw;
    });

    try {
      const response = await apiFetch(`/api/invoices/${invoice.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Review update failed');

      const updatedInvoice = data.invoice;
      const index = state.invoices.findIndex((item) => item.id === updatedInvoice.id);
      if (index >= 0) state.invoices[index] = updatedInvoice;
      state.selectedInvoiceId = updatedInvoice.id;
      renderInvoiceDetailPage(updatedInvoice);
      showToast('Invoice review saved and queued for approval', 'success');
    } catch (error) {
      showToast(error?.message || 'Unable to save review changes', 'error');
    }
  });

  document.getElementById('approveInvoiceButton')?.addEventListener('click', async () => {
    try {
      const response = await apiFetch(`/api/invoices/${invoice.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'approve' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Approval failed');
      let updated = data.invoice;
      if (canPerform('post')) {
        const postResponse = await apiFetch(`/api/invoices/${invoice.id}/action`, {
          method: 'POST',
          body: JSON.stringify({ action: 'post' })
        });
        const posted = await postResponse.json();
        if (!postResponse.ok) throw new Error(posted?.error || 'Posting failed');
        updated = posted.invoice;
      }
      const index = state.invoices.findIndex((item) => item.id === updated.id);
      if (index >= 0) state.invoices[index] = updated;
      renderInvoiceDetailPage(updated);
      showToast(canPerform('post') ? 'Invoice approved and posted' : 'Invoice approved and ready for posting', 'success');
    } catch (error) {
      showToast(error?.message || 'Approval could not be completed', 'error');
    }
  });

  document.getElementById('exportInvoiceButton')?.addEventListener('click', () => {
    showPremiumModal({
      title: 'Export invoice package',
      confirmText: 'Download JSON',
      bodyHtml: `
        <div class="modal-content-stack">
          <div class="summary-pill">Invoice #${invoice.invoiceNumber || 'N/A'}</div>
          <p>Export the selected invoice with validation checks, recommendations, and audit metadata for downstream ERP processing.</p>
          <div class="modal-metrics">
            <div><strong>${invoice.vendor || 'Unknown vendor'}</strong><span>Vendor</span></div>
            <div><strong>${formatMoney(invoice.amount || 0)}</strong><span>Amount</span></div>
            <div><strong>${invoice.confidence ?? 0}%</strong><span>Confidence</span></div>
          </div>
        </div>
      `,
      onConfirm: () => initExportPreview([invoice], 'json')
    });
  });

  document.getElementById('holdInvoiceButton')?.addEventListener('click', async () => {
    const response = await apiFetch(`/api/invoices/${invoice.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'hold' }) });
    const data = await response.json();
    if (!response.ok) return showToast(data.error || 'Hold failed', 'error');
    renderInvoiceDetailPage(data.invoice);
  });
  document.getElementById('rejectInvoiceButton')?.addEventListener('click', async () => {
    const response = await apiFetch(`/api/invoices/${invoice.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'reject', reason: 'Rejected from review workspace' }) });
    const data = await response.json();
    if (!response.ok) return showToast(data.error || 'Reject failed', 'error');
    renderInvoiceDetailPage(data.invoice);
  });
  document.getElementById('editInvoiceButton')?.addEventListener('click', () => {
    const firstField = document.querySelector('[data-edit-field]');
    firstField?.focus();
  });

  if (invoice.storagePath || invoice.fileName) {
    apiFetch(`/api/invoices/${invoice.id}/file`).then(async (response) => {
      if (!response.ok) return;
      const blob = await response.blob();
      const frame = document.querySelector('.document-preview');
      if (frame) frame.src = URL.createObjectURL(blob);
    }).catch(() => {});
  }
}

function getFilteredInvoices() {
  const rows = state.invoices || [];
  return rows.filter((invoice) => {
    const vendor = String(invoice.vendor || '').toLowerCase();
    const invoiceNumber = String(invoice.invoiceNumber || '').toLowerCase();
    const query = String(state.searchQuery || '').trim().toLowerCase();
    const matchesSearch = !query || vendor.includes(query) || invoiceNumber.includes(query);
    const matchesFilter = state.filterStatus === 'all' || String(invoice.status || '').toLowerCase().includes(state.filterStatus.toLowerCase());
    return matchesSearch && matchesFilter;
  });
}

function toggleInvoiceSelection(invoiceId) {
  const selected = state.bulkSelectedIds.includes(invoiceId);
  state.bulkSelectedIds = selected
    ? state.bulkSelectedIds.filter((id) => id !== invoiceId)
    : [...state.bulkSelectedIds, invoiceId];
  renderInvoicesPage();
}

async function applyBulkAction(action) {
  if (!state.bulkSelectedIds.length) return;
  const mapped = action === 'approve' ? 'approve' : action;
  for (const id of state.bulkSelectedIds) {
    const response = await apiFetch(`/api/invoices/${id}/action`, { method: 'POST', body: JSON.stringify({ action: mapped }) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      showToast(data.error || 'Bulk update failed', 'error');
      return;
    }
  }
  state.bulkSelectedIds = [];
  await loadInvoices();
  showToast('Selected invoices updated', 'success');
}

function renderInvoicesPage() {
  const rows = state.invoices || [];
  const posted = rows.filter((i) => String(i.status || '').toLowerCase().includes('posted')).length;
  const review = rows.filter((i) => String(i.status || '').toLowerCase().includes('review')).length;
  const failed = rows.filter((i) => String(i.status || '').toLowerCase().includes('failed')).length;
  const filteredRows = getFilteredInvoices();
  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((invoice) => state.bulkSelectedIds.includes(invoice.id));

  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Invoices', link: null }])}
      
      <div class="invoices-header">
        <div>
          <h2 style="margin: 0; color: var(--heading);">All Invoices</h2>
          <div class="invoices-subtitle">📊 ${rows.length} total • 📋 ${posted} posted • 👁️ ${review} review • ❌ ${failed} failed</div>
        </div>
        <button class="primary-button" id="uploadFromInvoices">+ Upload</button>
      </div>

      <div class="search-bar">
        <input type="text" class="search-input" id="searchInput" placeholder="Search by vendor or invoice #..." value="${state.searchQuery}" />
        <div class="filter-group">
          <button class="filter-btn ${state.filterStatus === 'all' ? 'active' : ''}" data-filter="all">All</button>
          <button class="filter-btn ${state.filterStatus === 'posted' ? 'active' : ''}" data-filter="posted">Posted</button>
          <button class="filter-btn ${state.filterStatus === 'review' ? 'active' : ''}" data-filter="review">Review</button>
          <button class="filter-btn ${state.filterStatus === 'failed' ? 'active' : ''}" data-filter="failed">Failed</button>
          <button class="filter-btn" id="advFilterBtn" style="margin-left: auto; background: rgba(14, 165, 233, 0.08); color: #0ea5e9; border-color: #0ea5e9;">⚙️ Filters</button>
        </div>
      </div>

      ${state.bulkSelectedIds.length ? `
        <div class="bulk-toolbar">
          <span>${state.bulkSelectedIds.length} selected</span>
          <div class="bulk-actions">
            <button class="bulk-btn approve" data-bulk-action="approve">✓ Approve</button>
            <button class="bulk-btn reject" data-bulk-action="reject">✕ Reject</button>
            <button class="bulk-btn hold" data-bulk-action="hold">⊘ Hold</button>
            <button class="bulk-btn" style="background: rgba(148, 163, 184, 0.12); color: #64748b;" id="clearBulk">Clear</button>
          </div>
        </div>
      ` : ''}

      <div class="table-card animate-slideUp">
        <div class="table-header">
          <span class="table-select"><input type="checkbox" class="row-select-all" ${allVisibleSelected ? 'checked' : ''}></span>
          <span>Vendor</span>
          <span>Invoice #</span>
          <span>Date</span>
          <span>Amount</span>
          <span>Confidence</span>
          <span>Status</span>
        </div>
        ${filteredRows.length ? filteredRows.map((invoice, idx) => `
          <div class="table-row" data-invoice-id="${invoice.id}" tabindex="0" style="cursor:pointer; animation-delay: ${0.05 + idx * 0.02}s;">
            <span class="table-select"><input type="checkbox" class="row-select" data-invoice-id="${invoice.id}" ${state.bulkSelectedIds.includes(invoice.id) ? 'checked' : ''} /></span>
            <span class="vendor-badge"><span class="vendor-dot"></span>${invoice.vendor || 'Unknown vendor'}</span>
            <span class="invoice-num">#${invoice.invoiceNumber || 'N/A'}</span>
            <span class="invoice-date">${invoice.date || '-'}</span>
            <span class="invoice-amount">${(invoice.currency === 'INR' ? formatInr : formatMoney)(invoice.amount || 0)}</span>
            <span><div class="confidence-badge" style="background: linear-gradient(to right, #10b981 0%, #10b981 ${invoice.confidence ?? 0}%, #e5e7eb ${invoice.confidence ?? 0}%, #e5e7eb 100%);" title="Confidence: ${invoice.confidence ?? 0}%"></div></span>
            <span><span class="table-status ${getStatusClass(invoice.status)}">${humanizeStatus(invoice.status || 'pending')}</span></span>
            <span class="row-actions" style="opacity: 0; position: absolute; right: 16px;">
              <button class="quick-action-btn" title="View">👁️</button>
              <button class="quick-action-btn" title="Approve">✓</button>
              <button class="quick-action-btn" title="More">⋮</button>
            </span>
          </div>
        `).join('') : `<div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div class="empty-state-title">No invoices found</div>
          <div class="empty-state-text">${getEmptyStateText()}</div>
        </div>`}
      </div>
    </div>
  `;

  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderInvoicesPage();
  });

  document.querySelectorAll('.filter-btn[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filterStatus = btn.dataset.filter;
      renderInvoicesPage();
    });
  });

  document.getElementById('advFilterBtn')?.addEventListener('click', () => {
    showToast('Advanced filters coming soon', 'info');
  });

  document.querySelectorAll('.bulk-btn[data-bulk-action]').forEach((btn) => {
    btn.addEventListener('click', () => applyBulkAction(btn.dataset.bulkAction));
  });

  document.getElementById('clearBulk')?.addEventListener('click', () => {
    state.bulkSelectedIds = [];
    renderInvoicesPage();
  });

  document.querySelector('.row-select-all')?.addEventListener('change', (event) => {
    const checked = event.target.checked;
    const visibleIds = filteredRows.map((invoice) => invoice.id);
    state.bulkSelectedIds = checked
      ? [...new Set([...state.bulkSelectedIds, ...visibleIds])]
      : state.bulkSelectedIds.filter((id) => !visibleIds.includes(id));
    renderInvoicesPage();
  });

  document.querySelectorAll('.row-select').forEach((checkbox) => {
    checkbox.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleInvoiceSelection(checkbox.dataset.invoiceId);
    });
  });

  document.getElementById('uploadFromInvoices')?.addEventListener('click', () => {
    state.currentView = 'upload';
    renderView();
  });

  appView.querySelectorAll('[data-invoice-id]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('input') || event.target.closest('.quick-action-btn')) return;
      const item = state.invoices.find((invoice) => invoice.id === row.dataset.invoiceId);
      if (!item) return;
      state.selectedInvoiceId = item.id;
      state.currentView = 'invoice-detail';
      renderInvoiceDetailPage(item);
    });

    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const item = state.invoices.find((invoice) => invoice.id === row.dataset.invoiceId);
        if (item) {
          state.selectedInvoiceId = item.id;
          state.currentView = 'invoice-detail';
          renderInvoiceDetailPage(item);
        }
      }
      if (event.key === ' ') {
        event.preventDefault();
        toggleInvoiceSelection(row.dataset.invoiceId);
      }
    });
  });
}

function renderWorkflowPage() {
  const workflows = state.invoices.map((invoice) => ({
    ...invoice,
    workflow: Array.isArray(invoice.workflow) && invoice.workflow.length ? invoice.workflow : [
      { step: 1, title: 'Invoice Ingestion', status: 'completed', detail: 'Invoice received and queued for processing.' },
      { step: 2, title: 'Data Extraction', status: 'completed', detail: 'Extraction and field validation complete.' },
      { step: 3, title: 'Vendor & PO Resolution', status: 'completed', detail: 'Vendor and PO resolution evaluated.' },
      { step: 4, title: 'ERP Record Pull', status: 'completed', detail: 'ERP data pull completed.' },
      { step: 5, title: 'Matching Engine', status: 'completed', detail: 'Quantity, rate, tax, and TDS checks executed.' },
      { step: 6, title: 'AI Reasoning', status: 'completed', detail: 'AI reasoning summary generated.' },
      { step: 7, title: 'Decision Routing', status: 'warning', detail: 'Review queue triggered for follow-up.' },
      { step: 8, title: 'Approval Action', status: 'pending', detail: 'Awaiting reviewer approval.' },
      { step: 9, title: 'Posting to ERP', status: 'pending', detail: 'Posting waits for approval.' },
      { step: 10, title: 'Post-Posting Reconciliation', status: 'pending', detail: 'Awaiting reconciliation.' }
    ]
  }));

  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Workflow', link: null }])}
      
      <div class="page-header">
        <div>
          <h1 class="page-title">Invoice Workflow</h1>
          <p class="page-subtitle">End-to-end processing pipeline from ingestion to ERP posting and reconciliation.</p>
        </div>
      </div>

      <div style="display: grid; gap: 20px;">
        ${workflows.map((invoice) => `
          <div class="section-card animate-slideUp">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom: 18px;">
              <div>
                <h3 style="margin:0; color: var(--heading);">${invoice.vendor || 'Unknown vendor'}</h3>
                <div style="color: var(--muted); font-size: 0.85rem; margin-top: 4px;">${invoice.invoiceNumber || 'N/A'} • ${invoice.date || 'N/A'}</div>
              </div>
              <span class="status-badge ${getStatusClass(invoice.status)}">${humanizeStatus(invoice.status)}</span>
            </div>
            <div style="display:grid; gap: 12px;">
              ${invoice.workflow.map((step) => {
                const stepColor = getStepColor(step.status);
                return `
                  <div style="display:grid; grid-template-columns: 32px 1fr 120px; gap: 12px; align-items: start; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.02); border-left: 3px solid ${stepColor};">
                    <div style="font-weight:700; color: var(--heading);">${step.step}</div>
                    <div>
                      <div style="font-weight:600; color: var(--heading); margin-bottom: 4px;">${step.title}</div>
                      <div style="color: var(--muted); font-size: 0.85rem; line-height: 1.5;">${step.detail}</div>
                    </div>
                    <div style="justify-self:end; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: ${stepColor}; font-weight: 700;">${step.status}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderExportsPage() {
  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Exports', link: null }])}
      
      <div class="page-header">
        <div>
          <h1 class="page-title">Export Data</h1>
          <p class="page-subtitle">Download your invoices in multiple formats for integration with ERP systems.</p>
        </div>
      </div>

      <div class="section-card animate-slideUp">
        <h3 style="margin-top:0; margin-bottom:20px; color: var(--heading);">Select Export Format</h3>
        <div class="exports-grid">
          <button class="export-card ${state.exportType === 'json' ? 'selected' : ''}" data-export="json" type="button">
            <h3 style="margin: 0 0 8px; color: var(--heading);">📄 JSON</h3>
            <p style="margin: 0; color: var(--muted); font-size: 0.9rem;">Machine-readable format with all fields and validations included</p>
          </button>
          <button class="export-card ${state.exportType === 'csv' ? 'selected' : ''}" data-export="csv" type="button">
            <h3 style="margin: 0 0 8px; color: var(--heading);">📊 CSV</h3>
            <p style="margin: 0; color: var(--muted); font-size: 0.9rem;">Spreadsheet format, one row per invoice for easy analysis</p>
          </button>
        </div>

        <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--line);">
          <h4 style="color: var(--heading); margin: 0 0 12px 0;">Export ${state.invoices.length} invoices as ${state.exportType.toUpperCase()}</h4>
          <div style="display: flex; gap: 12px;">
            <button class="primary-button export-button" id="previewButton" type="button">👁️ Preview Export</button>
            <button class="secondary-button export-button" id="downloadButton" type="button">⬇️ Download</button>
          </div>
        </div>
      </div>

      <div class="section-card animate-slideUp" style="margin-top: 22px; animation-delay: 0.1s;">
        <h3 style="margin-top: 0; color: var(--heading);">💡 About Exports</h3>
        <div style="color: var(--muted); line-height: 1.8; font-size: 0.9rem;">
          <p>• <strong>JSON</strong> includes complete invoice data, validation checks, AI reasoning, and ERP matching results</p>
          <p>• <strong>CSV</strong> provides a tabular view optimized for spreadsheet applications and data analysis</p>
          <p>• All exports include timestamp and processing metadata for audit trails</p>
        </div>
      </div>
    </div>
  `;

  appView.querySelectorAll('[data-export]').forEach((card) => {
    card.addEventListener('click', () => {
      state.exportType = card.dataset.export;
      renderExportsPage();
    });
  });

  document.getElementById('previewButton')?.addEventListener('click', () => {
    initExportPreview(state.invoices, state.exportType);
  });

  document.getElementById('downloadButton')?.addEventListener('click', () => {
    const data = state.exportType === 'json' ? state.invoices : state.invoices.map((inv) => ({
      vendor: inv.vendor,
      invoiceNumber: inv.invoiceNumber,
      date: inv.date,
      amount: inv.amount,
      status: inv.status,
      confidence: inv.confidence
    }));
    
    let content, filename, mimeType;
    if (state.exportType === 'json') {
      content = JSON.stringify(data, null, 2);
      filename = `invoices-export-${Date.now()}.json`;
      mimeType = 'application/json';
    } else {
      content = [
        ['Vendor', 'Invoice Number', 'Date', 'Amount', 'Status', 'Confidence'],
        ...data.map((inv) => [inv.vendor, inv.invoiceNumber, inv.date, inv.amount, inv.status, inv.confidence])
      ].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
      filename = `invoices-export-${Date.now()}.csv`;
      mimeType = 'text/csv';
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    
    showToastNotification(`Exported ${data.length} invoices to ${filename}`, 'success');
  });
}

function renderDashboardPage() {
  const metrics = {
    total: state.invoices.length,
    posted: state.invoices.filter((invoice) => !['failed', 'on hold'].includes(String(invoice.status || '').toLowerCase())).length,
    failed: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('failed')).length,
    volume: state.invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
    avgConfidence: state.invoices.length ? (state.invoices.reduce((sum, invoice) => sum + (invoice.confidence ?? 0), 0) / state.invoices.length).toFixed(1) : 0
  };

  const statusCounts = {
    posted: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('posted')).length,
    review: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('review')).length,
    failed: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('failed')).length,
    hold: state.invoices.filter((invoice) => String(invoice.status || '').toLowerCase().includes('hold')).length
  };

  const maxStatusValue = Math.max(...Object.values(statusCounts), 1);
  const riskScore = Math.min(98, Math.max(72, Number(metrics.avgConfidence) + 10));

  appView.innerHTML = `
    <div class="page-shell animate-fadeIn dashboard-shell">
      ${renderBreadcrumbBar([{ label: 'Dashboard', link: null }])}

      <div class="dashboard-hero section-card animate-slideUp">
        <div>
          <div class="eyebrow">Operations overview</div>
          <h1 class="page-title dashboard-title">Invoice Intelligence</h1>
          <p class="page-subtitle">Real-time financial processing overview across ERP validation, approvals, and exceptions.</p>
        </div>
        <div class="hero-summary">
          <span class="mini-pill success">Live</span>
          <strong>${formatMoney(metrics.volume)}</strong>
          <small>Processed volume</small>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-box animate-slideUp">
          <div class="stat-label">📦 Total Invoices</div>
          <div class="stat-value">${metrics.total}</div>
          <div class="stat-trend positive">+12.4% this week</div>
        </div>
        <div class="stat-box animate-slideUp" style="animation-delay: 0.05s;">
          <div class="stat-label">✅ Posted</div>
          <div class="stat-value">${metrics.posted}</div>
          <div class="stat-trend positive">Stable throughput</div>
        </div>
        <div class="stat-box animate-slideUp" style="animation-delay: 0.1s;">
          <div class="stat-label">⚠️ Exceptions</div>
          <div class="stat-value">${metrics.failed}</div>
          <div class="stat-trend warning">Needs review</div>
        </div>
        <div class="stat-box animate-slideUp" style="animation-delay: 0.15s;">
          <div class="stat-label">📊 Confidence</div>
          <div class="stat-value">${metrics.avgConfidence}%</div>
          <div class="stat-trend positive">Excellent extraction</div>
        </div>
      </div>

      <div class="action-row">
        <div class="action-card animate-slideUp" style="animation-delay: 0.2s;">
          <div class="action-icon">📤</div>
          <div class="action-label">Upload Invoice</div>
        </div>
        <div class="action-card animate-slideUp" style="animation-delay: 0.25s;">
          <div class="action-icon">👁️</div>
          <div class="action-label">Pending Reviews</div>
        </div>
        <div class="action-card animate-slideUp" style="animation-delay: 0.3s;">
          <div class="action-icon">📊</div>
          <div class="action-label">Export Summary</div>
        </div>
      </div>

      <div class="insights-grid">
        <div class="section-card animate-slideUp">
          <div class="card-header-row">
            <h3>Processing mix</h3>
            <span class="mini-pill neutral">This month</span>
          </div>
          <div class="chart-bars">
            ${Object.entries(statusCounts).map(([label, count]) => `
              <div class="chart-row">
                <div class="chart-label">${label.charAt(0).toUpperCase() + label.slice(1)}</div>
                <div class="chart-bar-track">
                  <div class="chart-bar ${label}" style="width: ${(count / maxStatusValue) * 100}%"></div>
                </div>
                <div class="chart-value">${count}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="section-card animate-slideUp" style="animation-delay: 0.05s;">
          <div class="card-header-row">
            <h3>AI risk score</h3>
            <span class="mini-pill warning">Moderate</span>
          </div>
          <div class="score-ring-wrap">
            <div class="score-ring" style="--score: ${riskScore};">
              <span>${Math.round(riskScore)}</span>
            </div>
            <ul class="ring-list">
              <li><span class="dot primary"></span> Vendor matching 96%</li>
              <li><span class="dot success"></span> Tax compliance 89%</li>
              <li><span class="dot warning"></span> Approval queue 74%</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="bottom-grid">
        <div class="section-card animate-slideUp">
          <div class="card-header-row">
            <h3>Audit trail</h3>
            <span class="mini-pill info">Live</span>
          </div>
          <div class="timeline">
            <div class="timeline-item">
              <div class="timeline-marker"></div>
              <div class="timeline-content">
                <div class="timeline-time">Today • 09:40</div>
                <div class="timeline-title">Invoice scanned and validated</div>
                <div class="timeline-description">Vendor, PO, and GST fields matched against ERP context</div>
              </div>
            </div>
            <div class="timeline-item">
              <div class="timeline-marker"></div>
              <div class="timeline-content">
                <div class="timeline-time">Today • 10:15</div>
                <div class="timeline-title">Review queue updated</div>
                <div class="timeline-description">2 invoices flagged for tax variance and manual approval</div>
              </div>
            </div>
            <div class="timeline-item">
              <div class="timeline-marker"></div>
              <div class="timeline-content">
                <div class="timeline-time">Today • 11:05</div>
                <div class="timeline-title">ERP posting batch approved</div>
                <div class="timeline-description">Posting summary exported and archived for audit traceability</div>
              </div>
            </div>
          </div>
        </div>

        <div class="section-card animate-slideUp" style="animation-delay: 0.1s;">
          <div class="card-header-row">
            <h3>Recent activity</h3>
            <button class="link-button" id="viewAllInvoices">View all</button>
          </div>
          ${state.invoices.slice(0, 5).length ? state.invoices.slice(0, 5).map((invoice) => `
            <div class="list-item recent-item">
              <div>
                <div class="recent-vendor">${invoice.vendor || 'Unknown vendor'}</div>
                <div class="recent-meta">${invoice.invoiceNumber || 'N/A'} • ${invoice.date || 'N/A'}</div>
              </div>
              <div class="recent-side">
                <div class="recent-amount">${formatMoney(invoice.amount || 0)}</div>
                <span class="badge ${getStatusClass(invoice.status)}">${humanizeStatus(invoice.status)}</span>
              </div>
            </div>
          `).join('') : '<div style="color: var(--muted);">No recent invoices</div>'}
        </div>
      </div>
    </div>
  `;

  document.getElementById('viewAllInvoices')?.addEventListener('click', () => {
    state.currentView = 'invoices';
    renderView();
  });
}

function showPremiumModal({ title, bodyHtml, confirmText = 'Confirm', onConfirm, onCancel }) {
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.innerHTML = `
    <div class="modal-panel">
      <div class="modal-header">
        <div>
          <div class="eyebrow">Action needed</div>
          <h3>${title}</h3>
        </div>
        <button class="modal-close" aria-label="Close">×</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-footer">
        <button class="secondary-button" type="button" data-modal-action="cancel">Cancel</button>
        <button class="primary-button" type="button" data-modal-action="confirm">${confirmText}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  const closeModal = () => {
    modalOverlay.remove();
    if (typeof onCancel === 'function') onCancel();
  };

  modalOverlay.querySelector('.modal-close').addEventListener('click', closeModal);
  modalOverlay.querySelector('[data-modal-action="cancel"]').addEventListener('click', closeModal);
  modalOverlay.querySelector('[data-modal-action="confirm"]').addEventListener('click', () => {
    modalOverlay.remove();
    if (typeof onConfirm === 'function') onConfirm();
  });

  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) closeModal();
  });
}

function renderPlaceholderPage(view) {
  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      <div class="page-header">
        <div>
          <h1 class="page-title">${view}</h1>
          <p class="page-subtitle">This section is ready for configuration.</p>
        </div>
      </div>
      <div class="section-card empty-state">Content for ${view} will be displayed here.</div>
    </div>
  `;
}

function renderView() {
  document.body.classList.toggle('dark-mode', state.darkMode);
  refreshFloatingActions();
  renderNav();

  switch (state.currentView) {
    case 'upload':
      renderUploadPage();
      break;
    case 'invoices':
      renderInvoicesPage();
      break;
    case 'workflow':
      renderWorkflowModule({ appView, state, renderBreadcrumbBar, getStatusClass, humanizeStatus, getStepColor });
      break;
    case 'exports':
      renderExportsModule({ appView, state, renderBreadcrumbBar });
      break;
    case 'exceptions':
      renderExceptionsPage({ appView, state, renderBreadcrumbBar, formatMoney });
      break;
    case 'dashboard':
      renderDashboardModule({ appView, state, renderBreadcrumbBar, formatMoney, getStatusClass, humanizeStatus });
      break;
    case 'invoice-detail':
      if (state.selectedInvoiceId) {
        const invoice = state.invoices.find((item) => item.id === state.selectedInvoiceId);
        renderInvoiceDetailPage(invoice);
      } else {
        renderInvoicesPage();
      }
      break;
    default:
      renderPlaceholderPage(state.currentView);
      break;
  }
  
  // Initialize tooltips after rendering
  setTimeout(() => addTooltips(), 100);
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    state.currentView = button.dataset.view;
    renderView();
  });
});

// Initialize dark mode
document.body.classList.toggle('dark-mode', state.darkMode);

// Setup theme toggle in header
const themeToggleBtn = document.getElementById('themeToggle');
if (themeToggleBtn) {
  setupThemeToggle(themeToggleBtn);
}

const sidebar = document.querySelector('.sidebar');
const sidebarToggle = document.createElement('button');
sidebarToggle.className = 'sidebar-toggle';
sidebarToggle.textContent = '⟨';
sidebarToggle.addEventListener('click', toggleSidebarCollapse);
sidebar.querySelector('.topbar-brand').appendChild(sidebarToggle);

const floatingActionBar = document.createElement('div');
floatingActionBar.className = 'floating-actions';
floatingActionBar.innerHTML = `
  <button class="floating-btn" id="undoAction" title="Undo (Z)">↶</button>
  <button class="floating-btn" id="redoAction" title="Redo (Y)">↷</button>
  <button class="floating-btn help-btn" id="helpAction" title="Help">?</button>
`;
document.body.appendChild(floatingActionBar);

document.getElementById('undoAction')?.addEventListener('click', undoLastAction);
document.getElementById('redoAction')?.addEventListener('click', redoLastAction);
document.getElementById('helpAction')?.addEventListener('click', () => {
  showToast('Shortcut keys: U Upload, D Dashboard, I Invoices, W Workflow, E Exports, Esc back, Z Undo, Y Redo', 'info');
});

function refreshFloatingActions() {
  const undoBtn = document.getElementById('undoAction');
  const redoBtn = document.getElementById('redoAction');
  if (undoBtn) undoBtn.disabled = !state.history.length;
  if (redoBtn) redoBtn.disabled = !state.redoStack.length;
}

// Setup keyboard shortcuts
setupKeyboardShortcuts();

// Enable enhanced keyboard shortcuts
enableKeyboardShortcuts({
  'u': () => { state.currentView = 'upload'; renderView(); },
  'd': () => { state.currentView = 'dashboard'; renderView(); },
  'i': () => { state.currentView = 'invoices'; renderView(); },
  'w': () => { state.currentView = 'workflow'; renderView(); },
  'e': () => { state.currentView = 'exports'; renderView(); }
});

// Enable sidebar collapse
enableSidebarCollapse();

// Add tooltip support
addTooltips();

// Add status badge animations
addStatusBadgeAnimations();

// Delegated event listeners
document.addEventListener('click', (e) => {
  const routeLink = e.target.closest('[data-route]');
  if (routeLink) {
    state.currentView = routeLink.dataset.route;
    renderView();
    return;
  }

  // Action card clicks on dashboard
  if (e.target.closest('.action-card')) {
    const label = e.target.closest('.action-card').querySelector('.action-label').textContent;
    if (label.includes('Upload')) {
      state.currentView = 'upload';
      renderView();
    } else if (label.includes('View Pending')) {
      state.filterStatus = 'review';
      state.currentView = 'invoices';
      renderView();
    } else if (label.includes('Export')) {
      state.currentView = 'exports';
      renderView();
    }
  }
  
  // Dashboard link from recent activity
  if (e.target.closest('.list-item')) {
    const cardContent = e.target.closest('.list-item');
    if (cardContent && state.currentView === 'dashboard') {
      state.currentView = 'invoices';
      renderView();
    }
  }
});

function refreshChrome() {
  const user = getUser();
  state.user = user;
  const name = document.getElementById('profileName');
  const role = document.getElementById('profileRole');
  const avatar = document.getElementById('profileAvatar');
  const queue = document.getElementById('queueCount');
  if (name) name.textContent = user?.name || 'Sign in';
  if (role) role.textContent = user?.role?.replaceAll('_', ' ') || 'Restricted';
  if (avatar) avatar.textContent = (user?.name || 'EM').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  if (queue) queue.textContent = `${state.metrics?.exceptions || 0} items`;
}

function showLogin(visible) {
  document.getElementById('loginGate')?.classList.toggle('hidden', !visible);
}

async function bootstrapSession() {
  if (!getToken()) {
    showLogin(true);
    return;
  }
  const me = await apiFetch('/api/auth/me');
  if (!me.ok) {
    clearSession();
    showLogin(true);
    return;
  }
  const payload = await me.json();
  state.user = payload.user;
  showLogin(false);
  refreshChrome();
  await loadInvoices();
}

// Initialize integrations
async function initializeIntegrations() {
  return;
}

document.getElementById('loginForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.email.value;
  const password = form.password.value;
  const errorEl = document.getElementById('loginError');
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Sign in failed');
    setSession(data.token, data.user);
    showLogin(false);
    refreshChrome();
    await loadInvoices();
  } catch (error) {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = error.message;
    }
  }
});

document.getElementById('profilePill')?.addEventListener('click', () => {
  if (!getUser()) {
    showLogin(true);
    return;
  }
  clearSession();
  showLogin(true);
  showToast('Signed out', 'info');
});

document.querySelector('.search-wrap input')?.addEventListener('input', (event) => {
  state.searchQuery = event.target.value;
  state.currentView = 'invoices';
  renderView();
});

window.addEventListener('easyme:unauthorized', () => showLogin(true));
window.addEventListener('easyme:navigate', () => renderView());

bootstrapSession();
