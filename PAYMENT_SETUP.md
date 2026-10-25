# ChowOnCampus payment setup

## Required Render environment variables

Set these on the existing ChowOnCampus web service:

- `PAYSTACK_SECRET_KEY`: a Paystack secret key. Start with a **test** secret key while testing; never commit it to GitHub or put it in frontend code.
- `PUBLIC_APP_URL`: `https://chowoncampus.onrender.com`

The checkout uses Paystack's server-side transaction initialization and verification endpoints. The secret key stays on the server.

## Paystack webhook

In the Paystack dashboard, configure this webhook URL:

`https://chowoncampus.onrender.com/api/payments/paystack/webhook`

The endpoint verifies Paystack's `x-paystack-signature` using HMAC-SHA512 before processing successful-charge events. Keep the webhook URL on HTTPS.

## Test before going live

1. Add a Paystack **test** secret key in Render's environment settings and redeploy/restart the service.
2. Create or sign in to a student account, add an item, fill the delivery details, and enter an email address for the receipt.
3. Continue to secure checkout and complete a Paystack test transaction.
4. Confirm the browser returns to ChowOnCampus and the order shows `Paid — Paystack verified` and `Confirmed`.
5. Confirm the restaurant sees the order only after payment verification; unpaid orders should not appear in restaurant/agent fulfilment lists.
6. Test an abandoned payment, a retry, and a mismatched/failed payment. None should confirm the order.
7. Only after successful test transactions, configure the live secret key in Render and use Paystack live mode.

The app does not mark an order paid based only on a browser redirect. It verifies the transaction with Paystack and checks reference, amount, currency, order metadata, and customer email. The signed webhook provides a second way to reconcile a successful payment if the customer closes the browser before returning.

**Important:** do not switch to live payments until test-mode checkout, webhook delivery, and order fulfilment have been checked end to end.
