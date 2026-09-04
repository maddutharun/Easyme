# Easyme

# Invoice Intelligence Hub

A runnable full-stack MVP for invoice intake, deterministic validation, ERP transaction matching, confidence scoring, and exception review.

## Run locally

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

Use `npm run dev` for Node watch mode. The default ERP adapter uses seeded demo records. Replace `DemoErpAdapter` in `server.js` with an authenticated ERP client when connecting to SAP, NetSuite, Dynamics, Oracle, or another system. Uploaded invoice state and audit records are stored locally under `data/` and are intentionally ignored by git.

## Included workflow

- Upload or simulate invoice intake
- OCR-ready invoice field model
- Vendor master-data and duplicate checks
- 2-way and 3-way matching
- Tax and total arithmetic validation
- Confidence and risk scoring
- Auto-post, review, hold, and query outcomes
- Exception queue with approval actions
- ERP adapter boundary and idempotent posting simulation
- Local JSON persistence for invoices and audit events
- Invoice file SHA-256 fingerprinting for re-upload detection foundations
- Health, vendor detail, and audit APIs

## Production hardening before auto-posting

Use a real OCR service, persistent database, ERP idempotency keys, SSO/RBAC, encrypted document storage, malware scanning, immutable audit logs, vendor-specific tolerance policies, human approval for sensitive changes, and a labeled test set that proves the measured auto-post error rate.
