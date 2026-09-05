export const state = {
  invoices: [],
  selectedInvoiceId: null,
  currentView: 'exceptions',
  activeFile: null,
  exportType: 'json',
  searchQuery: '',
  filterStatus: 'all',
  bulkSelectedIds: [],
  history: [],
  redoStack: [],
  sidebarCollapsed: false,
  darkMode: localStorage.getItem('darkMode') === 'true' || localStorage.getItem('theme') === 'dark',
  showOnboarding: localStorage.getItem('onboarded') !== 'true',
  user: null,
  metrics: { total: 0, posted: 0, exceptions: 0 },
  queueJobs: [],
  audit: []
};