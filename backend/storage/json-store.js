const fs = require('node:fs');
const path = require('node:path');

function createJsonStore(directory, seedInvoices) {
  fs.mkdirSync(directory, { recursive: true });
  const invoiceFile = path.join(directory, 'invoices.json');
  const auditFile = path.join(directory, 'audit.json');

  const defaultInvoices = Array.isArray(seedInvoices) ? seedInvoices.slice() : [];
  let invoices = defaultInvoices.slice();
  let audit = [];

  const safeArray = (value, fallback = []) => {
    if (Array.isArray(value)) return value;
    if (Array.isArray(fallback)) return fallback.slice();
    return [];
  };

  try {
    if (fs.existsSync(invoiceFile)) {
      const rawInvoiceData = fs.readFileSync(invoiceFile, 'utf8').trim();
      if (rawInvoiceData) {
        const parsed = JSON.parse(rawInvoiceData);
        if (Array.isArray(parsed)) {
          invoices = safeArray(parsed, defaultInvoices);
        } else if (parsed && Array.isArray(parsed.invoices)) {
          invoices = safeArray(parsed.invoices, defaultInvoices);
        }
      }
    }

    if (fs.existsSync(auditFile)) {
      const rawAuditData = fs.readFileSync(auditFile, 'utf8').trim();
      if (rawAuditData) {
        const parsed = JSON.parse(rawAuditData);
        audit = safeArray(parsed, []);
      }
    }
  } catch (error) {
    console.warn('[json-store] Local data could not be loaded; using seed data.', error.message);
    invoices = defaultInvoices.slice();
    audit = [];
  }

  if (!Array.isArray(invoices) || invoices.length === 0) {
    invoices = defaultInvoices.slice();
  }

  if (!Array.isArray(audit)) {
    audit = [];
  }

  const persist = () => {
    fs.writeFileSync(invoiceFile, JSON.stringify(invoices, null, 2));
    fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2));
  };

  return {
    get invoices() { return invoices; },
    get audit() { return audit; },
    addInvoice(invoice) { invoices.unshift(invoice); persist(); },
    recordAudit(action, invoice, detail, metadata = {}) {
      const entry = {
        id: require('node:crypto').randomUUID(),
        action,
        user: metadata.user || 'system',
        actor: metadata.actor || 'Poojith Reddy',
        entity: metadata.entity || 'invoice',
        entityId: invoice?.id || metadata.entityId || null,
        invoiceId: invoice?.id || null,
        detail: typeof detail === 'string' ? detail : JSON.stringify(detail ?? {}),
        details: typeof detail === 'object' && detail !== null ? detail : null,
        oldValue: metadata.oldValue ?? null,
        newValue: metadata.newValue ?? null,
        reason: metadata.reason || (typeof detail === 'string' ? detail : null),
        ip: metadata.ip || 'local',
        timestamp: new Date().toISOString(),
        at: new Date().toISOString(),
        model_version: metadata.model_version || metadata.aiVersion || 'local-rule-v1',
        ai_version: metadata.ai_version || metadata.aiVersion || 'local-rule-v1',
        rule_version: metadata.rule_version || metadata.ruleVersion || 'invoice-rules-v1',
        recommendation_version: metadata.recommendation_version || metadata.recommendationVersion || 'recommendation-v1',
        agent: metadata.agent || 'invoice-intelligence-mvp',
        metadata: metadata
      };
      audit.push(entry);
      persist();
      return entry;
    },
    persist
  };
}

module.exports = { createJsonStore };