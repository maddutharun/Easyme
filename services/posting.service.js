const { recordAudit } = require('./audit.service');

const APPROVAL_ROLES = {
  ap_clerk: ['approve', 'query'],
  ap_manager: ['approve', 'approve_override', 'reject', 'hold'],
  finance_approver: ['approve', 'approve_override', 'post', 'reject', 'hold'],
  admin: ['approve', 'approve_override', 'post', 'reject', 'hold', 'query']
};

const ensureRolePermission = (action, role) => {
  const normalizedRole = String(role || 'ap_manager').trim().toLowerCase();
  const permissions = APPROVAL_ROLES[normalizedRole] || [];
  if (!permissions.includes(action)) {
    throw new Error(`Role ${normalizedRole} is not allowed to perform action: ${action}`);
  }
};

const approveInvoice = async (invoice, context = {}) => {
  const role = context.role || 'ap_manager';
  ensureRolePermission('approve', role);

  if (invoice.status !== 'pending_review' && invoice.status !== 'ready_to_post') {
    throw new Error('Invoice must be in pending_review or ready_to_post status');
  }
  invoice.approval.required = false;
  invoice.approval.reviewer = context.reviewer || 'system';
  invoice.approval.approvedAt = new Date().toISOString();
  invoice.approval.role = role;
  invoice.status = 'approved';

  recordAudit('Invoice approved', invoice, 'Approved for posting', context);
  return invoice;
};

const postToErp = async (invoice, context = {}) => {
  const role = context.role || 'finance_approver';
  ensureRolePermission('post', role);

  if (invoice.status !== 'approved' && invoice.status !== 'ready_to_post') {
    throw new Error('Invoice must be approved before posting');
  }
  const docNum = 'ERP-' + Date.now().toString().slice(-6);
  invoice.posting.erpDocumentNumber = docNum;
  invoice.posting.postedAt = new Date().toISOString();
  invoice.posting.posted = true;
  invoice.posting.role = role;
  invoice.status = 'posted';

  recordAudit('Invoice posted', invoice, 'ERP Document: ' + docNum, context);
  return invoice;
};

const rejectInvoice = async (invoice, reason = '', context = {}) => {
  const role = context.role || 'ap_manager';
  ensureRolePermission('reject', role);

  invoice.status = 'rejected';
  invoice.posting.error = reason;
  invoice.posting.role = role;

  recordAudit('Invoice rejected', invoice, reason, context);
  return invoice;
};

module.exports = { approveInvoice, postToErp, rejectInvoice, APPROVAL_ROLES };
