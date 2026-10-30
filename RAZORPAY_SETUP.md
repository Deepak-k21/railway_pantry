# Razorpay online payments

The app supports Razorpay Standard Checkout and pay on delivery. Until the Razorpay credentials are configured, the menu offers pay on delivery and the server rejects online-payment submissions. The app never simulates a successful payment.

## 1. Configure test keys

Add these settings to your private `.env` for local development. If that file does not exist, copy `.env.example` once; do not overwrite existing configuration.

```dotenv
PAYMENTS_MODE=test
RAZORPAY_KEY_ID=rzp_test_REPLACE_WITH_YOUR_KEY_ID
RAZORPAY_KEY_SECRET=REPLACE_WITH_YOUR_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=REPLACE_WITH_A_SEPARATE_RANDOM_SECRET
```

Generate the Key ID and Key Secret in the Razorpay dashboard's Test Mode. A Key ID alone is not sufficient. Choose a separate random webhook secret of at least 32 characters:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Replace all placeholders. Keep secrets in backend configuration, never in `VITE_` variables or frontend code. The browser receives only the public Key ID and checkout order information. Do not paste private credentials into chat. Restart `npm run dev` after changing `.env`.

## 2. Configure Razorpay webhooks

In the dashboard's Test Mode, add a webhook pointing to `https://YOUR-PUBLIC-HOST/api/payments/webhook` with the same `RAZORPAY_WEBHOOK_SECRET`. Subscribe to:

- `payment.authorized`, `payment.captured`, `order.paid`, `payment.failed`
- `refund.created`, `refund.processed`, `refund.failed`

Use your actual HTTPS app address. Razorpay cannot reach a laptop's localhost URL. Local browser-return verification works with test keys, but webhook testing needs a reachable HTTPS deployment or development tunnel. Configure automatic capture in the dashboard. The backend can also capture a matching authorized payment during verification before its food reservation expires.

The webhook verifies the HMAC signature against the exact raw body. Other API routes retain their existing sessions, Origin checks and CSRF protection.

## 3. Verify the complete flow

1. Open a passenger QR, verify the mobile number, select food and enter a seat. Select **Pay online with Razorpay**, then **Continue to payment**.
2. Save the private tracking link. The app reserves stock for **15 minutes**. Select **Pay securely with Razorpay** and use Razorpay's documented test payment methods.
3. Confirm **Paid online** and the **TEST PAYMENT** badge. Test transactions transfer no real money. Only verified payment allows staff assignment.
4. Close checkout, resume it, and test a failed payment. These must not mark the request paid or create a second food request.
5. If a browser response is lost or a bank debit is uncertain, use **Check payment status** before paying again. The backend retrieves the provider's authoritative state.
6. Check webhook delivery and repeat delivery in the provider dashboard. Duplicate callbacks must not duplicate payment, stock reservations or refunds.
7. Cancel a paid request and verify the refund receipt. Also test admin cancellation, inability to fulfil, partial delivery, and an expired unpaid request. A late captured payment on a cancelled request is queued for refund instead of fulfilment.

Totals come from database prices and quantities, in integer paise. Browser-supplied prices are not trusted. Online totals must be at least ₹1. Verification checks the saved provider order ID, signature, payment ID, captured state, INR currency, full amount and paid provider order state. A success popup alone never authorizes fulfilment.

## 4. Refunds and recovery

Refund jobs are persisted atomically with cancellation/partial-delivery changes. Each uses Razorpay's `X-Refund-Idempotency` key so timeout retries cannot refund twice. The server reconciles every 30 seconds while running. Failed refund operations wait five minutes between attempts; after five attempts the app flags them for pantry support. Provider refund minimums or account restrictions can require manual resolution. Bank credit timing varies.

Admin **Requests → Recheck payments & refunds** triggers reconciliation. Signed refund webhooks update recorded refunds, including external dashboard refunds, and the backend prevents staff serving refunded payments. Preserve the database and stable `REPLAY_SECRET` across restarts.

On Cloudflare, the Worker schedule runs authenticated maintenance every five minutes, allowing payment/refund recovery without an open browser. This can keep the container warm and affects usage charges. The internal endpoint requires the private proxy secret; public incoming maintenance headers are stripped at the Worker. On another host, keep the server available or configure an authenticated scheduler and monitoring so queued refunds run promptly after restarts/sleep.

## 5. Deploy and switch to live mode

For Cloudflare, append the four Razorpay settings to the existing `.env.cloudflare`; keep the database, SMS, replay and proxy values unchanged. The deploy helper accepts these optional settings and passes them to the container as secrets. On another host, add them through its private environment configuration. Restart/redeploy after changing credentials.

Settle pending test payments/refunds before changing keys. Records retain their mode and public Key ID; the app refuses reconciliation through a different key configuration. Existing requests remain pay on delivery rather than being rewritten as paid.

After successful account testing and Razorpay activation, set `PAYMENTS_MODE=live`, the matching `rzp_live_…` Key ID and live Key Secret. Configure the webhook separately in Live Mode, use the corresponding webhook secret, and redeploy. Mismatched mode/key prefixes are rejected. Make an operator-approved small live payment/refund and verify it in both dashboards before accepting public orders. Never fulfil real food orders against Test Mode payments.

## What has been tested

Database tests cover tampered totals/currency, forged signatures, missing sessions/CSRF, stock holds, duplicate/reordered webhooks, authorized capture, callback recovery, expiry/late payments, idempotent refunds, partial delivery, external refunds and authenticated maintenance. Browser tests use an isolated provider fixture to exercise checkout loading, dismissal, server verification, tracking and refund display. There is no production fake-payment path.

An actual Razorpay test transaction and webhook delivery still require your test Key ID, Key Secret and webhook configuration; these cannot be claimed complete before account configuration.

Official references: [Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [Orders API](https://razorpay.com/docs/api/orders/create/), [refund idempotency](https://github.com/razorpay/markdown-docs/blob/master/api/refunds/normal-refunds-idempotent.md).
