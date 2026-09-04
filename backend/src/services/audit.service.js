  const createAuditEvent = ({ invoiceId, action, actorId, details = {} }) => ({
  invoiceId,
  action,
  actorId: actorId || 'system',
    details,
  createdAt: new Date().toISOString()
});

module.exports = { createAuditEvent };