export function renderWorkflowPage({ appView, state, renderBreadcrumbBar, getStatusClass, humanizeStatus, getStepColor }) {
  const defaultWorkflow = [
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
  ];
  const workflows = state.invoices.map((invoice) => ({
    ...invoice,
    workflow: Array.isArray(invoice.workflow) && invoice.workflow.length ? invoice.workflow : defaultWorkflow
  }));

  appView.innerHTML = `
    <div class="page-shell animate-fadeIn">
      ${renderBreadcrumbBar([{ label: 'Workflow', link: null }])}
      <div class="page-header"><div><h1 class="page-title">Invoice Workflow</h1><p class="page-subtitle">End-to-end processing pipeline from ingestion to ERP posting and reconciliation.</p></div></div>
      ${(state.queueJobs || []).length ? `<div class="section-card" style="margin-bottom:20px;"><h3>Processing queue</h3>${state.queueJobs.slice(0, 8).map((job) => `<div class="check-row"><div><strong>${job.payload?.invoiceId || job.id}</strong><div style="color:var(--muted);font-size:0.82rem;">${job.type} · ${job.status}</div></div></div>`).join('')}</div>` : ''}
      <div style="display: grid; gap: 20px;">
        ${workflows.map((invoice) => `
          <div class="section-card animate-slideUp">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom: 18px;">
              <div><h3 style="margin:0; color: var(--heading);">${invoice.vendor || 'Unknown vendor'}</h3><div style="color: var(--muted); font-size: 0.85rem; margin-top: 4px;">${invoice.invoiceNumber || 'N/A'} • ${invoice.date || 'N/A'}</div></div>
              <span class="status-badge ${getStatusClass(invoice.status)}">${humanizeStatus(invoice.status)}</span>
            </div>
            <div style="display:grid; gap: 12px;">
              ${invoice.workflow.map((step) => { const stepColor = getStepColor(step.status); return `<div class="workflow-step" style="--step-color: ${stepColor};"><div class="workflow-step-number">${step.step}</div><div><div class="workflow-step-title">${step.title}</div><div class="workflow-step-detail">${step.detail}</div></div><div class="workflow-step-status">${step.status}</div></div>`; }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
