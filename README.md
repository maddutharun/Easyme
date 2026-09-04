# Easyme

# Invoice Intelligence Hub

A full-stack AP workspace for invoice intake, deterministic validation, ERP matching, confidence scoring, exception review, and posting.

## Run locally

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.
5. Sign in with `finance@easyme.local` / `demo123` (full approve + post). Clerk and manager roles can review with the same password.

Use `npm run dev` for Node watch mode. Uploaded files live in `uploads/`. Invoice and audit state persist in SQLite at `backend/data/app.db`.

Set `AUTH_REQUIRED=false` only for local scripts. Production requires `JWT_SECRET`.

## Product path

- Role-based login (clerk, manager, finance approver, admin)
- Upload PDF / image / Excel invoices
- Extraction, 2-way and 3-way matching, GST/TDS checks
- Exception queue, field review, approve / hold / reject / post
- Demo ERP adapter with idempotent posting and failure cases
- SQLite persistence and immutable-style audit events

## Production hardening still required for live ERP auto-post

Connect a real OCR service and ERP client, vendor-specific tolerances, SSO/RBAC, encrypted document storage, malware scanning, and a labeled auto-post error-rate eval set.
