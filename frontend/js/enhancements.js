// Enhanced UI Features for Invoice Intelligence Hub

export function setupThemeToggle(toggleElement) {
  const savedTheme = localStorage.getItem('darkMode') === 'true'
    ? 'dark'
    : localStorage.getItem('theme') || 'light';
  const isDark = savedTheme === 'dark';

  document.body.classList.toggle('dark-mode', isDark);
  toggleElement.textContent = isDark ? '☀️' : '🌙';
  
  toggleElement.addEventListener('click', () => {
    const isDarkMode = document.body.classList.toggle('dark-mode');
    toggleElement.textContent = isDarkMode ? '☀️' : '🌙';
    localStorage.setItem('darkMode', String(isDarkMode));
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  });
}

export function showToastNotification(message, type = 'info', options = {}) {
  const container = document.getElementById('toastContainer') || createToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');
  
  const icon = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  }[type] || 'ℹ';
  
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${message}</span>
    ${options.undo ? '<button class="toast-undo">Undo</button>' : ''}
    <button class="toast-close" aria-label="Close">×</button>
  `;
  
  container.appendChild(toast);
  
  if (options.undo) {
    toast.querySelector('.toast-undo').addEventListener('click', options.undo);
  }
  
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });
  
  setTimeout(() => {
    toast.remove();
  }, options.duration || 5000);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toastContainer';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

export function addTooltips() {
  document.querySelectorAll('[data-tooltip]').forEach((element) => {
    if (element.querySelector('.tooltip-text')) return;
    
    const tooltip = document.createElement('span');
    tooltip.className = 'tooltip-text';
    tooltip.textContent = element.dataset.tooltip;
    element.appendChild(tooltip);
    element.classList.add('tooltip');
  });
}

export function showLoadingSpinner(container, message = 'Loading...') {
  container.innerHTML = `
    <div class="spinner-center">
      <div>
        <div class="spinner"></div>
        <p style="color: var(--muted); margin-top: 16px; text-align: center;">${message}</p>
      </div>
    </div>
  `;
}

export function showEmptyState(container, options = {}) {
  const {
    icon = '📭',
    title = 'No data found',
    description = 'Start by uploading an invoice or adjusting your filters',
    actionLabel = 'Upload Invoice',
    onAction = () => {}
  } = options;
  
  container.innerHTML = `
    <div class="empty-state-container">
      <div class="empty-state-icon">${icon}</div>
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-description">${description}</div>
      ${actionLabel ? `<button class="empty-state-button" id="emptyStateAction">${actionLabel}</button>` : ''}
    </div>
  `;
  
  const button = container.querySelector('#emptyStateAction');
  if (button) {
    button.addEventListener('click', onAction);
  }
}

export function showModalPreview(data, type = 'json', options = {}) {
  const {
    title = 'Preview',
    onConfirm = () => {},
    onCancel = () => {}
  } = options;
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  const preview = type === 'json' ? JSON.stringify(data, null, 2) : formatAsCSV(data);
  
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">${title}</h2>
        <button class="modal-close" id="modalClose">×</button>
      </div>
      <div class="modal-content">
        <div class="preview-box">${escapeHtml(preview)}</div>
      </div>
      <div class="modal-footer">
        <button class="secondary-button" id="modalCancel">Cancel</button>
        <button class="primary-button" id="modalConfirm">Confirm & Download</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  overlay.querySelector('#modalClose').addEventListener('click', () => {
    overlay.remove();
    onCancel();
  });
  
  overlay.querySelector('#modalCancel').addEventListener('click', () => {
    overlay.remove();
    onCancel();
  });
  
  overlay.querySelector('#modalConfirm').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      onCancel();
    }
  });
}

function formatAsCSV(data) {
  if (!Array.isArray(data) || !data.length) return 'No data';
  
  const headers = Object.keys(data[0]);
  const rows = data.map((item) => 
    headers.map((h) => {
      const val = item[h];
      const str = String(val === null || val === undefined ? '' : val);
      return `"${str.replace(/"/g, '""')}"`;
    }).join(',')
  );
  
  return [headers.join(','), ...rows].join('\n');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function updateBreadcrumbs(items) {
  const breadcrumb = document.querySelector('.breadcrumb');
  if (!breadcrumb) return;
  
  let html = '';
  items.forEach((item, idx) => {
    if (idx > 0) {
      html += '<span class="breadcrumb-separator">›</span>';
    }
    
    if (item.link) {
      html += `<a class="breadcrumb-link" data-view="${item.link}">${item.label}</a>`;
    } else {
      html += `<span class="breadcrumb-item active">${item.label}</span>`;
    }
  });
  
  breadcrumb.innerHTML = html;
  
  breadcrumb.querySelectorAll('.breadcrumb-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const event = new CustomEvent('navigate', { detail: { view: link.dataset.view } });
      document.dispatchEvent(event);
    });
  });
}

export function initProgressBar(message = 'Processing...') {
  const container = document.createElement('div');
  container.id = 'progressContainer';
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    padding: 12px 20px;
    z-index: 999;
  `;
  
  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div class="spinner-sm"></div>
      <span style="color: var(--text); font-size: 0.9rem;">${message}</span>
    </div>
    <div class="progress-bar" style="margin-top: 8px;">
      <div class="progress-fill"></div>
    </div>
  `;
  
  document.body.insertBefore(container, document.body.firstChild);
  
  return () => container.remove();
}

export function enableKeyboardShortcuts(shortcuts = {}) {
  const defaults = {
    'u': () => document.dispatchEvent(new CustomEvent('shortcut-upload')),
    'd': () => document.dispatchEvent(new CustomEvent('shortcut-dashboard')),
    'i': () => document.dispatchEvent(new CustomEvent('shortcut-invoices')),
    'w': () => document.dispatchEvent(new CustomEvent('shortcut-workflow')),
    'e': () => document.dispatchEvent(new CustomEvent('shortcut-exports')),
    '?': () => showToastNotification('Shortcuts: U=Upload, D=Dashboard, I=Invoices, W=Workflow, E=Exports, Esc=Back', 'info'),
    'escape': () => document.dispatchEvent(new CustomEvent('shortcut-back'))
  };
  
  const allShortcuts = { ...defaults, ...shortcuts };
  
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key !== '?') return;
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    
    const key = e.key.toLowerCase();
    if (allShortcuts[key]) {
      e.preventDefault();
      allShortcuts[key]();
    }
  });
}

export function renderTimelineWithTimestamps(workflow) {
  return workflow.map((step, idx) => {
    const time = new Date(Date.now() - (workflow.length - idx) * 3600000).toLocaleTimeString();
    const statusColors = {
      completed: '#10b981',
      pending: '#f59e0b',
      failed: '#ef4444',
      warning: '#f59e0b'
    };
    
    return `
      <div class="timeline-item ${step.status}">
        <div class="timeline-time">${time}</div>
        <div class="timeline-title">${step.title}</div>
        <div class="timeline-description">${step.detail}</div>
      </div>
    `;
  }).join('');
}

export function addStatusBadgeAnimations() {
  const style = document.createElement('style');
  style.textContent = `
    .status-badge {
      animation: fadeIn 0.4s ease-out;
    }
    
    .status-badge.pending {
      animation: pulse 1.5s ease-in-out infinite;
    }
    
    .status-badge.ready-to-post {
      animation: glow 2s ease-in-out infinite;
    }
    
    @keyframes glow {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(14, 165, 233, 0);
      }
      50% {
        box-shadow: 0 0 0 6px rgba(14, 165, 233, 0.2);
      }
    }
  `;
  document.head.appendChild(style);
}

export function enableSidebarCollapse() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  
  let isCollapsed = false;
  
  // Primary toggle: menu button in header
  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      sidebar.classList.toggle('collapsed', isCollapsed);
      localStorage.setItem('sidebarCollapsed', isCollapsed);
    });
  }
  
  // Secondary toggle: icon in sidebar (for when sidebar is expanded)
  const sidebarToggle = document.getElementById('sidebarToggle') || document.querySelector('.sidebar-toggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      sidebar.classList.toggle('collapsed', isCollapsed);
      localStorage.setItem('sidebarCollapsed', isCollapsed);
    });
  }
  
  // Restore state on page load
  const savedState = localStorage.getItem('sidebarCollapsed') === 'true';
  if (savedState) {
    sidebar.classList.add('collapsed');
    isCollapsed = true;
  }
}

export function initExportPreview(invoices, type = 'json') {
  const data = type === 'json' ? invoices : invoices.map((inv) => ({
    vendor: inv.vendor,
    invoiceNumber: inv.invoiceNumber,
    date: inv.date,
    amount: inv.amount,
    status: inv.status,
    confidence: inv.confidence
  }));
  
  return showModalPreview(data, type, {
    title: `Preview ${type.toUpperCase()} Export`,
    onConfirm: () => {
      downloadExport(data, type);
    }
  });
}

function downloadExport(data, type) {
  let content, filename, mimeType;
  
  if (type === 'json') {
    content = JSON.stringify(data, null, 2);
    filename = `invoices-export-${Date.now()}.json`;
    mimeType = 'application/json';
  } else {
    content = formatAsCSV(data);
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
  
  showToastNotification(`Export downloaded: ${filename}`, 'success');
}

export function initHelpTooltips() {
  const tooltips = {
    'confidence-badge': 'Overall extraction accuracy based on OCR and field validation',
    '3-way-match': 'Invoice quantity, rate, and receipt amount all match PO',
    'match-mode': 'Matching strategy: Exact, Fuzzy, or 2-way based on data quality',
    'tds-detection': 'Tax Deducted at Source compliance check for India invoices',
    'gst-validation': 'Goods and Services Tax number and amount verification',
    'duplicate-check': 'Invoice duplicate detection across uploaded history'
  };
  
  Object.entries(tooltips).forEach(([selector, text]) => {
    document.querySelectorAll(`[data-help="${selector}"]`).forEach((el) => {
      el.setAttribute('data-tooltip', text);
      el.classList.add('tooltip');
    });
  });
  
  addTooltips();
}

export function createQuickActionCard(icon, label, onClick) {
  const card = document.createElement('div');
  card.className = 'quick-action-card';
  card.innerHTML = `
    <div class="quick-action-icon">${icon}</div>
    <div class="quick-action-label">${label}</div>
  `;
  card.addEventListener('click', onClick);
  return card;
}

export function renderDashboardCharts(state) {
  const statusCounts = {
    posted: state.invoices.filter((i) => String(i.status || '').toLowerCase().includes('posted')).length,
    review: state.invoices.filter((i) => String(i.status || '').toLowerCase().includes('review')).length,
    failed: state.invoices.filter((i) => String(i.status || '').toLowerCase().includes('failed')).length,
    hold: state.invoices.filter((i) => String(i.status || '').toLowerCase().includes('hold')).length
  };
  
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0) || 1;
  
  return `
    <div class="chart-container">
      <div class="chart-title">Processing Status Distribution</div>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
        ${Object.entries(statusCounts).map(([label, count]) => `
          <div style="text-align: center;">
            <div class="mini-chart">
              <div class="mini-chart-bar" style="height: ${(count / total) * 100 || 0}%;"></div>
            </div>
            <div style="margin-top: 12px; font-weight: 600; color: var(--heading);">${label}</div>
            <div style="color: var(--muted); font-size: 0.85rem;">${count}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
