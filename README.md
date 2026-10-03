# Winner Top 1 / StreamEarn Backend

Express and MongoDB API for the Winner Top 1 / StreamEarn rewarded-video application. The service provides account registration and OTP verification, user profiles, video inventory, reward processing, wallet summaries, referrals, withdrawals, ad callback routes, and admin operations.

## Implementation Status

This repository contains a backend scaffold with registration, OTP verification, role-separated authentication, video rewards, reward-ledger entries, withdrawal requests, and Razorpay starter-payment endpoints. OTP delivery is supported through configured SMTP email or Twilio SMS. Full-watch verification, complete financial ledger coverage, and some ad-network callback integrations remain incomplete. See [BACKEND_REQUIREMENTS.md](BACKEND_REQUIREMENTS.md) for the target contract and remaining acceptance criteria.

## Requirements

- Node.js 18 or newer
- MongoDB replica set (required for transactional reward credits)

## Run Locally

Install packages:

```bash
npm install
```

Create a `.env` file in the project root. Minimum configuration:

```dotenv
PORT=5000
MONGO_URI=mongodb://localhost:27017/streamearn?replicaSet=rs0
JWT_USER_SECRET=replace-with-at-least-32-random-characters
JWT_ADMIN_SECRET=use-a-different-secret-of-at-least-32-characters
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30
RAZORPAY_KEY_ID=rzp_test_replace_me
RAZORPAY_KEY_SECRET=replace-with-test-key-secret
RAZORPAY_WEBHOOK_SECRET=replace-with-test-webhook-secret
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_smtp_username
SMTP_PASSWORD=your_smtp_password
OTP_FROM_EMAIL=no-reply@example.com
```

Start the API:

```bash
npm run dev
```

The API listens on `http://localhost:5000` by default. Check `GET /health` to verify the process is responding. `npm start` runs the service without nodemon. See `.env.example` for the complete SMTP and Twilio configuration options.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP listener port |
| `MONGO_URI` | `mongodb://localhost:27017/streamearn?replicaSet=rs0` | Replica-set MongoDB connection string |
| `JWT_USER_SECRET` | None | Recommended user access-token signing secret; at least 32 characters |
| `JWT_ADMIN_SECRET` | None | Recommended separate admin signing secret; at least 32 characters and different from the user secret |
| `ACCESS_TOKEN_TTL` | `15m` | Short-lived access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh-session lifetime in days |
| `PHONE_DEFAULT_REGION` | `IN` | Region used to normalize national-format phone numbers |
| `SMTP_HOST` | None | SMTP server for email OTP delivery |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | Use implicit TLS when set to `true` |
| `SMTP_USER` | None | SMTP username |
| `SMTP_PASSWORD` | None | SMTP password |
| `OTP_FROM_EMAIL` | None | Verified sender address for email OTPs |
| `TWILIO_ACCOUNT_SID` | None | Twilio account SID for SMS OTP delivery |
| `TWILIO_AUTH_TOKEN` | None | Server-only Twilio auth token |
| `TWILIO_FROM_NUMBER` | None | Twilio SMS-enabled sender number |
| `PUBLIC_APP_URL` | `https://app.example.com` | Base URL used to build referral links |
| `USD_INR_RATE_URL` | `https://open.er-api.com/v6/latest/USD` | Server-side USD exchange-rate endpoint used for conversion quotes |
| `RAZORPAY_KEY_ID` | None | Razorpay API key ID; returned to the client for Checkout |
| `RAZORPAY_KEY_SECRET` | None | Server-only Razorpay secret for order API and checkout signature verification |
| `RAZORPAY_WEBHOOK_SECRET` | None | Server-only secret configured for Razorpay webhook signature verification |
| `DAILY_REWARD_VIDEO_CAP` | `10` | Server-side daily rewarded-video cap |
| `USER_REVENUE_SHARE` | `0.5` | Fraction of verified gross revenue assigned to a viewer |
| `REFERRER_REVENUE_SHARE` | `0.1` | Fraction of verified gross revenue assigned to a referrer |
| `MIN_WITHDRAWAL_AMOUNT` | `50` | Minimum withdrawal amount in USD |
| `UNITY_ADS_SSV_SHARED_SECRET` | None | Shared secret checked by the Unity Ads callback scaffold |
| `ADMIN_EMAIL` | None | Email for the `create-admin` command |
| `ADMIN_PASSWORD` | None | Password for the `create-admin` command; must be at least 8 characters |

OTP codes are never returned by registration or resend endpoints. Registration defaults to email; pass `otpChannel: "sms"` to request Twilio delivery. Configure the corresponding provider credentials before use. Never expose JWT signing secrets, SMTP/Twilio credentials, or Razorpay secrets to clients.

For backwards compatibility, if both role-specific JWT variables are absent, a `JWT_SECRET` of at least 32 characters is domain-separated into distinct user/admin signing keys. Configure explicit `JWT_USER_SECRET` and `JWT_ADMIN_SECRET` values and remove `JWT_SECRET` when practical so the keys can be rotated independently.

Wallet and withdrawal amounts are denominated in USD. The currency quote endpoint converts a USD amount to INR using the configured exchange-rate service and caches the rate for one hour. It is a quote only; it does not create or confirm a UPI payment or payout.

## API Overview

All API endpoints are under `/api` unless shown otherwise. Protected endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Process health response |
| `POST` | `/api/auth/register` | Public | Validate details, bcrypt-hash the password, and deliver an OTP |
| `POST` | `/api/auth/verify-otp` | Public | Verify a one-time OTP and issue user access/refresh tokens |
| `POST` | `/api/auth/resend-otp` | Public | Resend an OTP subject to cooldown and hourly limits |
| `POST` | `/api/auth/login` | Public | Authenticate a verified active user and issue user access/refresh tokens |
| `POST` | `/api/auth/refresh` | Public | Rotate a refresh token and issue a new access token |
| `POST` | `/api/auth/logout` | Public | Revoke a refresh token |
| `GET` | `/api/user/profile` | User | Get the authenticated profile |
| `GET` | `/api/videos/daily` | User | List active ad placements and eligible sponsored campaigns |
| `POST` | `/api/videos/complete` | User | Attempt to credit a video reward |
| `GET` | `/api/wallet/balance` | User | Get the current wallet document |
| `GET` | `/api/wallet/transactions` | User | Get video rewards, withdrawals, and posted wallet ledger entries |
| `GET` | `/api/currency/usd-to-inr?amount=25` | Public | Quote a USD amount in INR |
| `POST` | `/api/payments/create-order` | User | Create an idempotent Razorpay INR order for the fixed `$25` starter plan |
| `POST` | `/api/payments/verify` | User | Verify the checkout signature and confirm the payment with Razorpay |
| `POST` | `/api/payments/webhook` | Razorpay | Verify the raw-body webhook signature and process captured/failed events once |
| `GET` | `/api/payments/:paymentId` | User | Get the authenticated user's payment status |
| `GET` | `/api/referrals/stats` | User | Get referral link, counts, and aggregate referral earnings |
| `POST` | `/api/withdrawals/request` | User | Request a withdrawal subject to the `$50` minimum, available balance, and seven-day eligibility window |
| `GET` | `/api/withdrawals/history` | User | Get the user's withdrawal records |
| `POST` | `/api/ad-callbacks/admob-ssv` | Callback | AdMob callback placeholder; currently returns `501` |
| `POST` | `/api/ad-callbacks/unity-ads-ssv` | Callback | Unity Ads callback scaffold; currently returns `501` |
| `POST` | `/api/admin/login` | Public, rate limited | Authenticate an admin account and issue an admin-only access/refresh pair |
| `GET/POST` | `/api/admin/videos` | Admin | List or create ad-network placements |
| `PUT` | `/api/admin/videos/:id` | Admin | Update an ad-network placement |
| `GET/POST` | `/api/admin/sponsored-content` | Admin | List or create sponsored campaigns |
| `PUT` | `/api/admin/sponsored-content/:id` | Admin | Update a sponsored campaign |
| `GET` | `/api/admin/users` | Admin | List users, optionally filtered by status or search |
| `PUT` | `/api/admin/users/:id/status` | Admin | Activate or block a user |
| `GET` | `/api/admin/ledger` | Admin | Aggregate ad revenue and configured payout shares |
| `GET` | `/api/admin/withdrawals` | Admin | List withdrawals by status (default `PENDING`) |
| `PUT` | `/api/admin/withdrawals/:id` | Admin | Mark a withdrawal paid or rejected |
| `PUT` | `/api/admin/settings/referral-share` | Admin | Placeholder; currently returns `501` |

Create an order with `Authorization: Bearer <token>`, a unique `Idempotency-Key` header, and `{ "amount": 25, "method": "upi" }` or `{ "amount": 25, "method": "bank" }`. The server ignores no client price: any amount other than `$25` is rejected. It returns Razorpay's public key ID, order ID, payment record ID, INR amount in paise, currency, saved USD/INR quote, and expiry. Use these values with Razorpay Checkout, then send Razorpay's `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` to `/api/payments/verify`.

Configure the webhook endpoint as `POST https://<your-api-host>/api/payments/webhook` in the Razorpay dashboard. Subscribe to `payment.captured` and `payment.failed`. The API verifies `X-Razorpay-Signature` over the raw request bytes and deduplicates `X-Razorpay-Event-Id`.

## Create An Admin

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`, then run:

```bash
npm run create-admin
```

The script creates a verified admin user with a bcrypt-hashed password. It refuses to create a duplicate email and requires a password of at least eight characters.

## Project Layout

```text
server.js                 Express app and route mounting
scripts/createAdmin.js    Admin account setup
src/config/db.js          MongoDB connection
src/controllers/          Request handlers and business logic
src/middleware/auth.js    JWT authentication and admin-role checks
src/models/               Mongoose schemas
src/models/WalletTransaction.js Immutable wallet transaction records
src/models/Payment.js       Razorpay order and payment state
src/models/PaymentWebhookEvent.js Processed Razorpay event IDs
src/routes/               API route definitions
src/utils/                Referral-code and JWT helpers
```

## Scripts And Tests

| Command | Purpose |
|---|---|
| `npm run dev` | Start with nodemon |
| `npm start` | Start the API |
| `npm run create-admin` | Create an admin account |
| `npm run migrate-auth` | Remove legacy plaintext OTPs from existing accounts; run once before deploying the new auth flow |
| `npm test` | Run authentication-token and payment-signature unit tests |

Reward, payment, and OTP-verification session creation use MongoDB transactions, so configure local MongoDB as a replica set as well as using a replica-set-capable deployment. Unit tests cover token separation and payment-signature validation; provider delivery and gateway end-to-end tests require SMTP/Twilio credentials or Razorpay test keys and a reachable webhook URL.

## Production Warning

The immutable ledger currently records video, referral, and starter-payment credits; withdrawals and administrative adjustments are not yet posted to it. The payment endpoints are implemented but have not been tested against your Razorpay account. Do not use live credentials until checkout and webhook behavior has been verified in Razorpay test mode. Remaining production work includes server-side full-watch verification, decimal-safe accounting, complete ledger coverage, verified ad callback signatures, HTTPS, restricted CORS, request validation, and deployment-specific rate limits/secrets. The exchange-rate endpoint returns a cached quote, not a payment guarantee.
