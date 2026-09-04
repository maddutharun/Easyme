let auditLog = [];

const recordAudit = (action, entity, details = '', meta = {}) => {
  const entry = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    action,
    entityId: entity && entity.id ? entity.id : meta.entityId || null,
    entityType: 'invoice',
    details,
    user: meta.user || 'system',
    ip: meta.ip || '0.0.0.0',
    versions: {
      app: meta.app_version || 'v1.0.0',
      aiModel: meta.ai_version || 'v1.0.0',
      rules: meta.rule_version || 'v1.0.0'
    },
    changes: { oldValue: meta.oldValue, newValue: meta.newValue }
  };

  auditLog.unshift(entry);
  return entry;
};

const getAuditLog = (limit = 50) => auditLog.slice(0, limit);
const getAuditFor = (entityId, limit = 50) => auditLog.filter((entry) => entry.entityId === entityId).slice(0, limit);

module.exports = { recordAudit, getAuditLog, getAuditFor };
