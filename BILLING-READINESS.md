# Mitriva recurring billing readiness

Status: SAFE-DISABLED (19 November 2026). Not live, no charges possible.

## Razorpay merchant
The existing ICONAIS Razorpay merchant currently approved for TaazaDrop displays:
"Additional websites must follow the same business model as your first site.
For a different business model, you'll need to create a separate Razorpay account,
though you can use the same login credentials."
Mitriva is dating/matchmaking, not grocery delivery. Do not enable TaazaDrop's
merchant credentials for Mitriva without explicit, documented Razorpay approval.
The user may share the same Razorpay sign-in and company identity with a new MID.

## India Google Play
Subscriptions to dating features are digital services. For Play-distributed
India Android apps, enrol in the applicable user-choice/alternative billing
program, satisfy its requirements, and provide Google Play Billing where needed.
Do not direct buyers to Razorpay checkout until policy requirements are met.

## Prepared API
- GET  /api/v1/mitriva/billing/plans (authenticated): plan catalog and enabled flag.
- POST /api/v1/mitriva/billing/subscriptions (authenticated): server-only plan mapping, recurring consent, provider subscription creation.
- POST /api/v1/mitriva/billing/subscriptions/verify (authenticated): HMAC on stored subscription ID, fetch provider subscription AND captured payment, verify amount/currency/expiry before Premium activation.
- GET  /api/v1/mitriva/billing/subscriptions/current (authenticated): status.
- POST /api/v1/mitriva/billing/subscriptions/cancel (authenticated): cancellation at cycle end.
- POST /api/v1/mitriva/billing/webhooks/razorpay (signed raw-body): event deduplication, charged and refunded payment reconciliation, cancellation/expiry.
- Existing /subscription and /entitlements endpoints now enforce paid-period expiry.

## Server secret configuration
Place variables from .env.example in GoDaddy Mitriva app Settings > Environment
Variables. Never put secrets in Git, Flutter, a screenshot, or this document.
Create the three Razorpay plans in the Mitriva approved merchant dashboard:
  monthly: INR 199 every 1 month;
  quarterly: INR 499 every 3 months;
  annual: INR 1499 every 1 year.
Record their `plan_...` IDs in the respective environment variables.
Use a NEW webhook secret for Mitriva only and configure the webhook URL above.
This secret is independent of API keys (not a key rotation).

## Safety checks before enabling
1. Merchant MID, business classification and full Razorpay Subscriptions capability approved.
2. Google Play India alternative billing enrollment and app integration completed.
3. Complete genuine user consent, subscription pricing and cancellation language.
4. Test all three plans, signature forgery, captured-vs-authorised, cancellations,
   failed charge, full refund, duplicate webhook, renewal, chargeback and expiration.
5. Configure a merchant support and refund process, reconcile Razorpay with DB.
6. Verify raw webhook secrets and idempotent processing in staging.
7. Only then set all three MITRIVA_* readiness flags to true and test controlled live flow.

TaazaDrop endpoints, merchant secrets, and existing API keys must not be rotated.
