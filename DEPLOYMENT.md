# Mitriva standalone GoDaddy deployment

This package runs **only Mitriva**. It does not mount LudoVoxa or any other ICONAIS application.

## Before first launch

1. In GoDaddy/cPanel, create a Node.js application for a dedicated subdomain such as `mitriva-api.iconaisconsulting.com`.
2. Create a **new dedicated MySQL database and database user** for Mitriva. Do not reuse the shared ICONAIS database.
3. Copy `.env.example` to `.env` in the application root and set all database values plus a unique `MITRIVA_JWT_SECRET`.
4. Run `npm install --omit=dev`.
5. Set the application startup file to `app.js`, then restart the Node.js application.
6. Verify:
   - `GET /health`
   - `GET /api/v1/mitriva/system/bootstrap-status`

The app creates an empty Mitriva schema at startup. Existing data must be copied only from tables beginning `mtr_`.

## Data migration

Export **only** the `mtr_` tables from the shared database, then import them into the new dedicated database. Do not import:
- `lvx_`, `w10_`, `tzd_`, `dhb_`, `lst_`, or `kpx_` tables
- the shared `users` table
- the shared `iconais_otp_challenges` table

After import, restart the standalone app and verify record counts, authentication, discovery, messaging, Google sign-in, and account deletion.

## Play reviewer access

Set the three `MITRIVA_PLAY_REVIEW_*` values only on the server. Use a dedicated reviewer phone number and OTP, never a customer number. The feature is disabled by default.
