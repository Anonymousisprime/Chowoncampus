# ChowOnCampus Security and Data-Protection Review
Date: 2026-10-29

## Scope and limits
This is a code/configuration review of the current application and Render resource metadata/logs. It is not a penetration test, legal compliance certification, or proof that every route is safe. Database row contents were not queried because the database IP allowlist blocks external access; do not weaken that allowlist just to enable an external inspection.

## Findings observed

### Addressed in the security review branch
- Add baseline response headers, disable Express's `X-Powered-By` fingerprint, set production proxy handling, and mark API responses as non-cacheable.
- Reject cross-origin browser writes when an Origin header is present, while leaving the Paystack webhook to its separate signature check.
- Add in-process throttles for student registration/login, staff login, order creation, and Paystack initialize/verify routes.
- Enforce the eight-hour server-side session lifetime to match the cookie lifetime.
- Use the trusted Express request IP for password-reset throttling instead of trusting a caller-supplied `X-Forwarded-For`.
- Only retain the raw request body for the Paystack webhook, where it is required for signature verification.
- Use a fixed HTTPS payment callback origin rather than deriving it from the incoming Host header.
- Validate that Paystack's returned checkout URL is HTTPS and hosted at `checkout.paystack.com`.
- Prevent FoodBack orders from entering the Paystack initialization/verification flow and require Paystack order type when processing payment events.

### Database and persistence
- Render reports a PostgreSQL database named `chowoncampus-db` in the `available` state.
- Application logs show “Persistent PostgreSQL storage initialized,” which is evidence that the running service has initialized PostgreSQL storage.
- The application stores most non-order data as JSONB documents in `coc_app_store` and orders as individual rows in `coc_orders`. This is persistent, but the JSONB documents contain personal and operational data and writes are serialized through a single application-level queue.
- The database is on Render's Free plan and the Render metadata shows an expiry date of **2026-11-22**. Arrange an upgrade or a verified migration before then; do not assume the database will remain available indefinitely.
- An external read-only database query was blocked by the empty IP allowlist. Keep the database private; use Render's internal connection from the application or a locally authenticated Render MCP connection rather than opening it to all IPs.
- Backup status and a successful restore have **not** been verified in this review.

### Remaining risks / actions required before real payments
1. **Test before merge/deploy.** Exercise registration, login throttling, logout/session expiry, cross-origin blocking, restaurant/agent role isolation, Paystack checkout URL validation, signed webhook verification, amount/reference checks, and FoodBack rejection in a preview or test environment. No real-money test is performed by this review.
2. **Database continuity.** Before 2026-11-22, upgrade the database plan or migrate to a durable database. Take a backup/export, verify the export contains expected record counts without exposing personal data, and test a restore to a separate database before cutover.
3. **Backups and recovery.** Confirm what backups the selected plan supports, set an owner and schedule, keep a separate protected copy, and document restore steps. Never rely on Git history or local JSON files as the only backup.
4. **Secrets and access.** Keep `DATABASE_URL`, Paystack secret keys, subaccount codes, Twilio credentials, VAPID private key, and seeded admin/restaurant passwords only in Render environment variables. Never paste values into GitHub or chat. Enable MFA on GitHub, Render, Paystack, and the recovery email. Restrict production deploy and environment-variable permissions. Rotate secrets if exposure is suspected.
5. **Rate-limit durability.** Current throttles and sessions are in process memory. They reset on restart and are not shared across multiple instances. Before scaling, move them to a shared store and use durable session storage.
6. **Data minimization.** Orders currently retain student names, phone numbers, delivery details and GPS coordinates, and payment receipt email. Define and publish a retention period; restrict access by role; remove/anonymize precise location details when no longer needed for fulfilment, disputes or accounting; and provide a support process for privacy requests.
7. **Database access.** Keep the Postgres IP allowlist private. Use least-privilege credentials, verify who can access the Render workspace/database, and review access after staff changes.
8. **Monitoring and audit trail.** Add alerts for failed logins, unusual order/payment attempts, database persistence failures, admin changes, and changes to production environment variables. Preserve audit records for sensitive administrative actions.
9. **Application hardening still needed.** CSP is intentionally not added here because current pages use inline scripts and require a compatibility review. The JSON body parser permits 24 MB for menu image payloads; keep this in mind for resource-exhaustion risk and consider a dedicated bounded image-upload path.
10. **Concurrency.** FoodBack balances, order state and other JSONB-backed data are read/modified/written by application logic rather than all being guarded by database transactions. Before higher-volume launch or multiple instances, move balance debits/credits and payment/order transitions into transactional database operations with idempotency constraints.

## Launch recommendation
Do not merge/deploy these code changes to the live site until the preview/test checklist passes. Do not accept real payments until the Paystack test, database continuity, backup/restore, and secret-access checks are complete.
