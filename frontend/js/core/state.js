export const state = {
  invoices: [],
  selectedInvoiceId: null,
  currentView: 'upload',
  activeFile: null,
  exportType: 'json',
  searchQuery: '',
  filterStatus: 'all',
  bulkSelectedIds: [],
  history: [],
  redoStack: [],
  sidebarCollapsed: false,
  darkMode: localStorage.getItem('darkMode') === 'true',
  showOnboarding: localStorage.getItem('onboarded') !== 'true'
};