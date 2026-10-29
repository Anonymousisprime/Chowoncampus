# ChowOnCampus Security Hardening — Review Checklist

This branch adds defensive controls to the existing Express app without changing the student, restaurant, agent, admin, FoodBack, or order workflow.

## Implemented in this branch
- Standard browser security headers, disables the Express fingerprint header, and disables API caching.
- Checks browser Origin on state-changing API requests (Paystack's signed webhook remains separately HMAC-verified).
- Applies server-side rate limits to student registration, student/staff sign-in, order creation, Paystack initialization, and Paystack verification.
- Expires server-side sessions after eight hours, matching the session cookie lifetime.
- Accepts payment redirect URLs only when HTTPS and hosted on `checkout.paystack.com`.
- Prevents Paystack checkout for FoodBack orders and pins the payment return URL to `PUBLIC_APP_URL` (with the known Render hostname as a safe fallback).

## Required before production launch
1. In Render, verify `PAYSTACK_SECRET_KEY` is a live secret key and that each `PAYSTACK_SUBACCOUNT_<RESTAURANT_ID>` is the intended restaurant subaccount. Never place these values in frontend files or GitHub.
2. Set `PUBLIC_APP_URL=https://chowoncampus.onrender.com` (or the exact HTTPS custom domain if the project later adopts one).
3. Rotate Paystack secret keys and all admin/restaurant passwords immediately if there is any suspicion they were exposed; use Render environment variables for secrets.
4. Enable MFA on GitHub, Render, Paystack, and the email account used for recovery; restrict who can change Render environment variables and merge to the production branch.
5. Add automated tests for student/admin role isolation, cross-origin writes, login throttling, checkout URL validation, split-account correctness, and Paystack webhook signature/amount/reference checks.
6. Replace in-memory sessions and file/JSON-style app storage with shared durable storage before scaling to multiple instances. Add persistent distributed rate limiting, audit logs, database backups, and alerts for admin login/payment configuration changes.
7. Do not consider this a full penetration test. Test the deployed preview with small/test-mode payments first and confirm the destination/subaccount in Paystack before accepting real student payments.

## Important boundary
This code can stop a browser redirect from being returned unless it points to Paystack's official checkout host, but it cannot protect a compromised GitHub/Render account, leaked Paystack secret, altered environment variable, or compromised database by itself. Those control planes must also be secured.
