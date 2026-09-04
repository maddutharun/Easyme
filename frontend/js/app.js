import { state } from './core/state.js';
import { bytesToSize, formatInr, formatMoney } from './core/format.js';
import { getStatusBadgeClass, getStatusClass, getStepColor, humanizeStatus } from './core/status.js';
import { renderBreadcrumb } from './core/dom.js';
import { showToast } from './core/toast.js';
import { renderDashboardPage as renderDashboardModule } from './pages/dashboard.js';
import { renderExportsPage as renderExportsModule } from './pages/exports.js';
import { renderWorkflowPage as renderWorkflowModule } from './pages/workflow.js';
import { renderExceptionsPage } from './pages/exceptions.js';
import { renderInvoiceDetailPage as renderInvoiceDetailModule } from './pages/review.js?v=sage7';
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
  localStorage.setItem('theme', state.darkMode ? 'dark' : 'light');
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

function navigateTo(view) {
  if (!view) return;
  state.currentView = view;
  if (view === 'invoices') {
    state.filterStatus = 'all';
    state.searchQuery = '';
  }
  renderView();
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch(e.key.toLowerCase()) {
      case 'x': state.currentView = 'exceptions'; renderView(); break;
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
    if (summaryResponse.status === 401) {
      state.invoices = [];
      state.audit = [];
      state.metrics = { total: 0, posted: 0, exceptions: 0 };
      showLogin(true);
      showToast('Your session expired. Please sign in again.', 'info');
      return;
    }
    if (!summaryResponse.ok) {
      const failure = await summaryResponse.json().catch(() => ({}));
      throw new Error(failure.error || `Invoice loading failed (${summaryResponse.status})`);
    }
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

  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, message: 'File is too large. Please keep each invoice under 10 MB.' };
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
            <p class="upload-copy">Drop a PDF, image, or Excel file, or <strong>browse</strong></p>
            <p class="upload-help">PDF, PNG, JPG, TIFF, XLSX — 10 MB max for matching</p>
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

      <div class="section-card" style="margin-top: 28px;">
        <h3 style="margin: 0 0 12px 0; color: var(--heading);">Accepted sources</h3>
        <p style="margin: 0; color: var(--muted); font-size: 0.9rem;">
          Text PDFs extract immediately. Images use OCR. Spreadsheets map vendor, amount, tax, and PO columns.
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
      statusEl.textContent = validation.message;
      return;
    }

    const formData = new FormData();
    formData.append('invoice', state.activeFile);

    statusEl.className = 'upload-status info';
    statusEl.textContent = 'Extracting fields and matching to ERP…';

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
      state.activeFile = null;
      state.currentView = 'invoice-detail';
      const existingIndex = state.invoices.findIndex((item) => item.id === data.invoice.id);
      if (existingIndex >= 0) state.invoices[existingIndex] = data.invoice;
      else state.invoices.unshift(data.invoice);
      refreshChrome();
      renderView();
      await loadInvoices();
      const processedInvoice = state.invoices.find((item) => item.id === data.invoice.id) || data.invoice;
      state.selectedInvoiceId = processedInvoice.id;
      renderInvoiceDetailPage(processedInvoice);
      showToast('Invoice processed and ready to review', 'success');
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Upload timed out. The server may be busy or unreachable.'
        : !navigator.onLine
          ? 'Network is offline. Please reconnect and retry.'
          : error?.message?.includes('Failed to fetch') || error?.message?.includes('fetch')
            ? 'Server is not reachable. Start the app with npm start and retry.'
            : error?.message || 'Unable to parse the uploaded invoice.';

      statusEl.className = 'upload-status error';
      statusEl.textContent = message;
    }
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderInvoiceDetailPage(invoice) {
  renderInvoiceDetailModule({
    appView,
    invoice,
    state,
    renderBreadcrumbBar,
    renderView,
    showToast,
    showPremiumModal,
    initExportPreview,
    refreshChrome
  });
}

function getFilteredInvoices() {
  const rows = state.invoices || [];
  return rows.filter((invoice) => {
    const haystack = `${invoice.vendor || ''} ${invoice.invoiceNumber || ''} ${invoice.po || ''} ${invoice.status || ''} ${invoice.statusLabel || ''}`.toLowerCase();
    const query = String(state.searchQuery || '').trim().toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    const status = String(invoice.status || '').toLowerCase();
    const filter = state.filterStatus;
    const matchesFilter = filter === 'all'
      || (filter === 'posted' && status.includes('posted'))
      || (filter === 'review' && (status.includes('review') || status === 'query_open' || status === 'ready_to_post'))
      || (filter === 'hold' && status.includes('hold'))
      || (filter === 'failed' && (status.includes('fail') || status.includes('reject')));
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
          <div class="invoices-subtitle">${rows.length} total · ${posted} posted · ${review} in review · ${failed} failed</div>
        </div>
        <button class="primary-button" id="uploadFromInvoices">+ Upload</button>
      </div>

      <div class="search-bar">
        <input type="text" class="search-input" id="searchInput" placeholder="Vendor, invoice, PO, or status" value="${state.searchQuery}" />
        <div class="filter-group">
          <button class="filter-btn ${state.filterStatus === 'all' ? 'active' : ''}" data-filter="all">All</button>
          <button class="filter-btn ${state.filterStatus === 'posted' ? 'active' : ''}" data-filter="posted">Posted</button>
          <button class="filter-btn ${state.filterStatus === 'review' ? 'active' : ''}" data-filter="review">Review</button>
          <button class="filter-btn ${state.filterStatus === 'hold' ? 'active' : ''}" data-filter="hold">On hold</button>
          <button class="filter-btn ${state.filterStatus === 'failed' ? 'active' : ''}" data-filter="failed">Failed</button>
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
          <span>Open</span>
        </div>
        ${filteredRows.length ? filteredRows.map((invoice) => `
          <div class="table-row" data-invoice-id="${invoice.id}" tabindex="0">
            <span class="table-select"><input type="checkbox" class="row-select" data-invoice-id="${invoice.id}" ${state.bulkSelectedIds.includes(invoice.id) ? 'checked' : ''} /></span>
            <span class="vendor-badge"><span class="vendor-dot"></span>${invoice.vendor || 'Unknown vendor'}</span>
            <span class="invoice-num">#${invoice.invoiceNumber || 'N/A'}</span>
            <span class="invoice-date">${invoice.date || '-'}</span>
            <span class="invoice-amount">${(invoice.currency === 'INR' ? formatInr : formatMoney)(invoice.amount || 0)}</span>
            <span><div class="confidence-badge" style="background: linear-gradient(to right, #10b981 0%, #10b981 ${invoice.confidence ?? 0}%, #e5e7eb ${invoice.confidence ?? 0}%, #e5e7eb 100%);" title="Confidence: ${invoice.confidence ?? 0}%"></div></span>
            <span><span class="table-status ${getStatusClass(invoice.status)}">${humanizeStatus(invoice.status || 'pending')}</span></span>
            <span>
              <button class="quick-action-btn" data-quick="view" data-invoice-id="${invoice.id}" type="button" title="Review">Open</button>
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

  document.querySelectorAll('.table-row[data-invoice-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const item = state.invoices.find((invoice) => invoice.id === row.dataset.invoiceId);
      if (!item) return;
      state.selectedInvoiceId = item.id;
      state.currentView = 'invoice-detail';
      renderInvoiceDetailPage(item);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      row.click();
    });
  });

  document.getElementById('uploadFromInvoices')?.addEventListener('click', () => {
    state.currentView = 'upload';
    renderView();
  });

  appView.querySelectorAll('[data-quick="view"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const item = state.invoices.find((invoice) => invoice.id === button.dataset.invoiceId);
      if (!item) return;
      state.selectedInvoiceId = item.id;
      state.currentView = 'invoice-detail';
      renderInvoiceDetailPage(item);
    });
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
  state.darkMode = localStorage.getItem('darkMode') === 'true' || localStorage.getItem('theme') === 'dark';
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
  button.addEventListener('click', () => navigateTo(button.dataset.view));
});

// Initialize dark mode
document.body.classList.toggle('dark-mode', state.darkMode);

// Setup theme toggle in header
const themeToggleBtn = document.getElementById('themeToggle');
if (themeToggleBtn) {
  setupThemeToggle(themeToggleBtn);
}

document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebarCollapse);

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
  showToast('Shortcuts: X Exceptions, U Upload, D Dashboard, I Invoices, W Workflow, E Exports', 'info');
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
  'x': () => { state.currentView = 'exceptions'; renderView(); },
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

  if (e.target.closest('.action-card')) {
    const route = e.target.closest('.action-card').dataset.route;
    if (route) {
      state.currentView = route;
      if (route === 'exceptions') state.filterStatus = 'review';
      renderView();
    }
    return;
  }

  if (e.target.closest('.list-item') && state.currentView === 'dashboard') {
    return;
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
  if (queue) queue.textContent = String(state.metrics?.exceptions || 0);

  const menu = document.getElementById('accountMenu');
  if (menu) {
    menu.innerHTML = user ? `
      <div style="padding:8px 10px; color:var(--muted); font-size:0.8rem;">${user.email}<br>${user.role.replaceAll('_', ' ')}</div>
      <button type="button" data-demo-email="finance@easyme.local">Switch to finance</button>
      <button type="button" data-demo-email="manager@easyme.local">Switch to manager</button>
      <button type="button" data-demo-email="clerk@easyme.local">Switch to clerk</button>
      <button type="button" id="signOutButton">Sign out</button>
    ` : '<button type="button" id="signOutButton">Sign in</button>';
  }

  const notices = document.getElementById('noticePanel');
  if (notices) {
    const items = (state.audit || []).slice(0, 6);
    notices.innerHTML = items.length
      ? items.map((entry) => `<button class="notice-item" type="button"><strong>${entry.action || 'Event'}</strong><div style="color:var(--muted);font-size:0.78rem;">${entry.detail || ''}</div></button>`).join('')
      : '<div class="notice-item">No alerts yet</div>';
  }
}

function showLogin(visible) {
  document.getElementById('loginGate')?.classList.toggle('hidden', !visible);
  document.body.classList.toggle('is-authed', !visible);
}

async function bootstrapSession() {
  try {
    const configResponse = await fetch('/api/config');
    const config = await configResponse.json();
    if (!config.demoMode) {
      document.querySelector('.login-hint')?.setAttribute('hidden', 'hidden');
      document.querySelector('.role-chips')?.setAttribute('hidden', 'hidden');
    }
  } catch (error) {
    // keep demo login copy if config is unavailable
  }
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
  state.currentView = 'exceptions';
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
  const submitButton = form.querySelector('.login-submit');
  const submitLabel = submitButton?.querySelector('.login-submit-label');
  if (submitButton) submitButton.disabled = true;
  if (submitLabel) submitLabel.textContent = 'Signing in…';
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
    state.currentView = 'exceptions';
    refreshChrome();
    await loadInvoices();
    showToast(`Signed in as ${data.user.name}`, 'success');
  } catch (error) {
    if (submitButton) submitButton.disabled = false;
    if (submitLabel) submitLabel.textContent = 'Continue';
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = error.message;
    }
  }
});

document.getElementById('profilePill')?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!getUser()) {
    showLogin(true);
    return;
  }
  const menu = document.getElementById('accountMenu');
  const open = menu.classList.toggle('open');
  document.getElementById('profilePill').setAttribute('aria-expanded', String(open));
  document.getElementById('noticePanel')?.classList.remove('open');
});

document.getElementById('accountMenu')?.addEventListener('click', async (event) => {
  event.stopPropagation();
  const demoEmail = event.target.closest('[data-demo-email]')?.dataset.demoEmail;
  if (demoEmail) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: demoEmail, password: 'demo123' })
    });
    const data = await response.json();
    if (!response.ok) return showToast(data.error || 'Switch failed', 'error');
    setSession(data.token, data.user);
    document.getElementById('accountMenu')?.classList.remove('open');
    refreshChrome();
    await loadInvoices();
    showToast(`Now acting as ${data.user.name}`, 'success');
    return;
  }
  if (event.target.closest('#signOutButton')) {
    clearSession();
    document.getElementById('accountMenu')?.classList.remove('open');
    document.getElementById('profilePill')?.setAttribute('aria-expanded', 'false');
    showLogin(true);
    showToast('Signed out', 'info');
  }
});

document.getElementById('noticeToggle')?.addEventListener('click', (event) => {
  event.stopPropagation();
  const panel = document.getElementById('noticePanel');
  panel.hidden = false;
  panel.classList.toggle('open');
  document.getElementById('accountMenu')?.classList.remove('open');
});

document.getElementById('reportsButton')?.addEventListener('click', () => {
  state.currentView = 'exports';
  renderView();
});

document.getElementById('togglePassword')?.addEventListener('click', () => {
  const input = document.getElementById('loginPassword');
  const hidden = input.type === 'password';
  input.type = hidden ? 'text' : 'password';
  document.getElementById('togglePassword').textContent = hidden ? 'Hide' : 'Show';
});

document.querySelectorAll('.role-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.getElementById('loginEmail').value = chip.dataset.email;
    document.querySelectorAll('.role-chip').forEach((item) => item.setAttribute('aria-pressed', String(item === chip)));
    document.getElementById('loginPassword').focus();
  });
});

document.addEventListener('click', () => {
  document.getElementById('accountMenu')?.classList.remove('open');
  document.getElementById('noticePanel')?.classList.remove('open');
});

document.getElementById('globalSearch')?.addEventListener('input', (event) => {
  state.searchQuery = event.target.value;
  state.currentView = 'invoices';
  renderView();
});

const loginForm = document.getElementById('loginForm');
loginForm?.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const focusable = [...loginForm.querySelectorAll('input, button')].filter((el) => !el.disabled);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

window.addEventListener('easyme:unauthorized', () => showLogin(true));
window.addEventListener('easyme:navigate', () => renderView());

bootstrapSession();
