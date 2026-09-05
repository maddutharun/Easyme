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

Set `AUTH_REQUIRED=false` only for local scripts. Production requires `JWT_SECRET` and always enforces login.

## Production

- Set `NODE_ENV=production` and a unique `JWT_SECRET` (the development default is rejected).
- Keep `AUTH_REQUIRED=true`. Health stays public; queue, observability, roles, and pipeline require a session.
- Uploads still use the same extract → match → review → post path. Email-style intake is `POST /api/inbox/ingest` (same file field `invoice`). IRN JSON is `POST /api/inbox/einvoice`.
- Optional `DOCUMENT_AI_URL` enriches fields after local extraction; if unset, nothing changes.
- Optional `ERP_BASE_URL` uses the REST ERP adapter; otherwise the demo adapter stays in place.
- `AUTO_POST_ENABLED` only marks eligibility. `AUTO_POST_EXECUTE` is required to post without the UI action, and stays false by default.
- Optional mailbox watch: `INBOX_WATCH=true` and `INBOX_DIR`.
- Optional SSO start: `OIDC_AUTHORIZE_URL` + `OIDC_CLIENT_ID` (token exchange is not implemented until an IdP is wired).
- Optional `STORAGE_DRIVER=s3` with `S3_PUT_URL`, `CLAMAV_URL`, and `REDIS_URL` for object storage, malware scan, and a worker.
- Audit CSV: `GET /api/exports/audit` (finance/admin). Extraction eval: `GET /api/eval/extraction`.
- Files are stored under `STORAGE_PATH` and cannot be read outside that directory.

Live SAP/Oracle connectivity, a real IdP token exchange, SOC 2, and customer Document AI accounts are still customer-environment work. The product flow does not require those to run.

## Product path

- Role-based login (clerk, manager, finance approver, admin)
- Upload PDF / image / Excel / IRN JSON invoices
- Extraction, line-level 2-way and 3-way matching, GST/TDS checks
- Exception queue, field review, vendor query thread, approve / hold / reject / post
- Demo ERP adapter with idempotent posting; REST adapter when `ERP_BASE_URL` is set
- SQLite persistence and immutable-style audit events
- Golden extraction eval pack under `tests/eval`

## What stays off until you turn it on

Auto-post execute, inbox directory watch, ClamAV, S3 PUT, OIDC, and HTTP Document AI all default off. `npm start` does not need API keys.
