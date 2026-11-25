# ChowOnCampus Express

Independent, mobile-first ordering and operations platform for ChowOnCampus.

## Current MVP

- Student registration and sign-in with salted PBKDF2 password hashes
- PostgreSQL (or local SQLite) persistence
- Business and available-product catalogue
- Single-business cart and order submission
- Gate / room delivery details and room-only agent gender preference
- Order totals using current delivery charges

## Operating rules

- Gate delivery: ₦300.
- Room delivery: ₦400 total (₦300 delivery + ₦100 room surcharge).
- Product prices are set by each participating business.
- Only participating campus businesses are listed.
- Room delivery uses the student's selected male/female agent preference; gate delivery does not require gender matching.
- No payment gateway is connected. The app records an order and calculates the expected amount; it does not receive, hold, or transfer money.
- Any changed product price or unavailable item must be confirmed by the student before purchase.

## Run locally

From this directory:

1. Create a Python virtual environment.
2. Install dependencies: `pip install -r requirements.txt`.
3. Initialize the database: `python -m express.init_db`.
4. Start the app: `reflex run`.

Set `DATABASE_URL` to a PostgreSQL connection string in deployment. If omitted, local development uses SQLite.

The seed catalogue contains deliberately unavailable sample items. Add verified businesses and products through future admin tooling before accepting real orders.

## Production checklist

This is a development MVP, not ready for real student data or live operations. Before launch:
- Add admin-managed agent/business accounts, role-based dashboards and server-side authorization.
- Add session hardening, login throttling, password reset and audit logs.
- Add database migrations, automated backups and managed file storage for receipts.
- Add per-order financial reconciliation with explicit review states.
- Add dispatch acceptance/timeout logic and test room-delivery gender matching.
- Configure HTTPS, secret storage, monitoring and privacy/retention controls.
- Do not store bank account numbers in public GitHub files or expose one agent's account details to other users.
