# ChowOnCampus Web MVP

This is a new Flask-based web application scaffold on the `chowoncampus-web-today` branch. The existing `main` branch and the earlier `chowoncampus-express` branch are left untouched.

## Run locally

```bash
python -m venv .venv
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`.

## Environment variables

- `SECRET_KEY`: set a long random secret in deployment.
- `DATABASE_PATH`: SQLite database path. SQLite is suitable for local testing only; use managed PostgreSQL before live operations.
- `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`: optional first-admin bootstrap. Set all three privately in the host dashboard, use a long random token and a password of at least 12 characters, open `/setup-admin`, submit the token, then remove the bootstrap token from the host environment immediately after the first admin is created.

## Current implemented prototype

- Student, business and agent account registration; business and agent accounts wait for admin approval.
- Password hashing and signed sessions.
- Business product listing and online/offline switch.
- Student order placement with ₦300 gate delivery and ₦400 room delivery.
- Room-only hostel, room number and male/female agent preference fields.
- Business can mark a placed order ready; the app offers it to one available eligible agent. Gate orders do not apply gender matching; room orders do.
- Agent can accept an offered order using a database write lock to prevent two agents winning the same order.
- First-admin bootstrap is disabled until environment variables are configured.

## Not ready for real operations

This is an early MVP scaffold, not a production-ready delivery platform. It currently uses SQLite, has no automated offer timeout/background worker, no receipt upload, no student change-approval workflow, no full delivery/handover lifecycle, no robust audit/ledger reconciliation, and only basic admin approval/order screens. The business dispatch action currently sends an offer to one available agent; decline/retry logic still needs to be added. There is no payment gateway and no money is collected or transferred. Do not enter real customer information or accept live orders until PostgreSQL, stronger authorization/RLS-equivalent policies, tests, backups, monitoring, and the missing workflows are completed.

## Deployment

`render.yaml` is a starting Render Blueprint. The configured SQLite path requires a persistent disk, which is not included in the free Render plan. Do not deploy this Blueprint for live data as-is. Switch to managed PostgreSQL and configure backups before production.
