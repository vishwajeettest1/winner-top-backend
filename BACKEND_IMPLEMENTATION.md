# Backend Implementation Guide

This guide maps the Winner Top 1 / StreamEarn product requirements and companion frontend documentation to the backend currently present in this repository. It is both an implementation inventory and a practical plan for completing the production API. A feature is marked implemented only when the current backend actually provides it; a frontend screen or a documented requirement does not imply a backend capability.

## Product Rules

The reference documents establish these user-facing rules:

- A user signs up with a mobile number and email, then verifies an OTP.
- The fixed starter amount is `$25.00`; a successful, server-verified payment is required before activation.
- Users may earn from at most 10 eligible videos per business day, and a reward is due only after a verified full watch.
- Wallet balance and rewards are authoritative backend values.
- Referral attribution and referral earnings must be tracked by the backend.
- The minimum withdrawal is `$50.00`; the frontend needs an authoritative seven-day deadline and expected date.
- Add Money offers UPI or bank/net-banking through a payment gateway. Only a verified gateway event can credit funds.
- Admin-only operations manage users, content, withdrawals, and financial oversight.

The detailed original contracts and acceptance criteria are in [BACKEND_REQUIREMENTS.md](BACKEND_REQUIREMENTS.md). The companion frontend's stated implementation and expected API are in [FRONTEND_IMPLEMENTATIONS.md](FRONTEND_IMPLEMENTATIONS.md) and [FRONTEND_REQUIREMENTS.md](FRONTEND_REQUIREMENTS.md).

## Status Summary

| Capability | Current backend status | Relevant implementation |
|---|---|---|
| Registration and password hashing | Implemented | Validates email, E.164-normalizes phone numbers, enforces an 8-72 byte password range, and uses bcrypt cost 12 |
| OTP verification | Implemented, provider-configured | Cryptographically random six-digit OTP, bcrypt hash at rest, 10-minute expiry, five attempts, 60-second resend cooldown, five sends per hour, and SMTP/Twilio delivery |
| User and admin authentication | Implemented | Separate 15-minute access-token audiences/secrets, hashed refresh tokens, rotation, reuse-family revocation, and logout revocation |
| USD-to-INR currency quote | Partial | `GET /api/currency/usd-to-inr` gets and caches a server-side USD/INR rate for one hour; payment and payout settlement are not integrated |
| `$25` payment and starter activation | Partial | Razorpay order, checkout verification, signed webhook, payment records, and one-time starter credit are implemented; account test keys and end-to-end verification are still required |
| Wallet balance | Partial | Per-user mutable MongoDB wallet plus immutable, idempotent reward/payment credit entries; withdrawal and adjustment entries are not wired |
| Video inventory | Partial | Admin-managed ad placements and sponsored campaigns |
| Full-watch reward validation | Not implemented | Completion accepts only source type and ID; no watch-duration or signed-session proof |
| Daily video cap | Partial | Server-side count uses a configurable cap, default 10; no explicit business timezone |
| Duplicate reward protection | Partial | Unique per-user/source/business-day keys and MongoDB transaction protect reward posting; daily cap still lacks concurrency serialization across distinct videos |
| Referral attribution and reporting | Partial | Signup attribution, generated referral codes, activity counts, and aggregate wallet earnings |
| Referral qualification and payout rules | Partial | Referred users may receive a configured share per qualifying completion; precise product commission policy is not persisted or fully specified |
| `$50` withdrawal and seven-day deadline | Partial | USD minimum and request-window timestamps are stored; payout date, destination, and race-safe reservation are not implemented |
| Ad network callback verification | Not production ready | Both callback routes are placeholders; AdMob is unverified and Unity persistence is missing |
| Support and About content APIs | Not implemented | Product content currently belongs to the frontend; no support/configuration API exists |
| Automated tests | Partial | `npm test` covers checkout and webhook signature validation; database transactions and Razorpay test-mode flows are not covered |

## Runtime And Architecture

The application is an Express 4 service using Mongoose and MongoDB. `server.js` loads environment variables, installs CORS and JSON middleware, retains raw request bytes for the Razorpay webhook route, applies rate limits to authentication, payment creation/verification, and admin login, mounts API routers, exposes `GET /health`, and connects to MongoDB before listening. The default port is `5000`; transactional flows require a replica-set MongoDB URI such as `mongodb://localhost:27017/streamearn?replicaSet=rs0`.

Request flow:

1. A route in `src/routes/` selects public, authenticated, or admin-only access.
2. `src/middleware/auth.js` verifies the bearer JWT, reloads the account, and attaches it to `req.user`. Admin routes additionally require `role === 'admin'`.
3. The controller validates a subset of the request and reads or updates Mongoose models in `src/models/`.
4. Controllers respond with JSON. There is no shared request-schema validation layer or centralized domain/service layer yet.

Main data models:

| Model | Current purpose |
|---|---|
| `User` | Email, normalized mobile, password hash, OTP hash/attempt/send state, starter activation, referral attribution/code, status, and role |
| `RefreshToken` | Hashed opaque refresh token, user/admin role, family ID, expiry, consumption, replacement, and revocation state |
| `Wallet` | Mutable USD total, video and referral earnings, pending withdrawal, and seven-day request-window timestamps; one per user |
| `WalletTransaction` | Immutable USD credit/debit record with type, amount, status, and unique per-user/type/reference key |
| `Payment` | Fixed starter-plan USD price, INR paise quote, exchange-rate snapshot, Razorpay order/payment IDs, idempotency key, state, and expiry |
| `PaymentWebhookEvent` | Unique Razorpay event IDs processed by the webhook handler |
| `Video` | An ad-network placement slot and its active state |
| `SponsoredContent` | Sponsored video campaign, dates, budget, spend, and payout per view |
| `VideoWatchLog` | Completed watch and reward amount |
| `AdRevenueLog` | Gross revenue plus viewer/referrer shares and a verification method |
| `Withdrawal` | Requested amount, processing status, review/payment timestamps, and references |

There is no support-ticket or persisted product-settings model yet. Money fields currently use JavaScript/MongoDB `Number`, which is not a decimal-safe representation for financial accounting.

## API Reference

Protected requests use `Authorization: Bearer <JWT>`. Responses below describe the current API unless explicitly identified as a required future contract.

### Authentication And Profile

| Method and path | Current behavior |
|---|---|
| `POST /api/auth/register` | Accepts `mobileNumber`, `email`, `password`, optional `referralCode`, and optional `otpChannel` (`email` by default or `sms`); normalizes/validates inputs, hashes the password, stores only a bcrypt OTP hash, and delivers the code. Response contains `userId` and expiry, never the OTP. |
| `POST /api/auth/verify-otp` | Accepts `userId` and six-digit `otpCode`; atomically consumes a valid nonexpired code, marks the account verified, creates the wallet, and issues user access/refresh tokens. |
| `POST /api/auth/resend-otp` | Accepts `userId` and optional `otpChannel`; enforces cooldown and hourly send caps, then replaces the one-time code/hash. |
| `POST /api/auth/login` | Accepts `email` and `password`; returns a short-lived user access token and opaque refresh token for a verified active user account. |
| `POST /api/auth/refresh` | Accepts `{ "refreshToken": "..." }`; consumes and rotates the refresh token, keeps the same user/admin role and family, and revokes the family if a used token is replayed. |
| `POST /api/auth/logout` | Accepts `{ "refreshToken": "..." }` and revokes that refresh token. Existing access tokens expire within their short TTL. |
| `POST /api/admin/login` | Issues a separate admin access/refresh token pair only for an active admin account. |
| `GET /api/user/profile` | Returns safe user profile fields, excluding password hash and OTP lifecycle metadata. |

OTP delivery requires SMTP configuration for email or Twilio configuration for SMS. Registration defaults to email; the endpoint never returns an OTP. Resend is limited to one request per minute and five sends per rolling hour; verification allows five attempts per code. Password hashes use bcrypt cost 12 and reject passwords longer than bcrypt's 72-byte input limit. Prefer separate, random `JWT_USER_SECRET` and `JWT_ADMIN_SECRET` values of at least 32 characters. If both are absent, a legacy `JWT_SECRET` of at least 32 characters is domain-separated into distinct role keys for backwards compatibility; migrate to explicit role secrets for independent rotation. Store refresh tokens only as SHA-256 hashes; access tokens are role/audience-bound and expire after 15 minutes by default.

When upgrading a database created by the previous scaffold, run `npm run migrate-auth` once before deploying. It removes legacy plaintext `otpCode` values and invalidates any old OTP so an unverified user must request a fresh code.

### Video Catalog And Rewards

| Method and path | Current behavior |
|---|---|
| `GET /api/videos/daily` | Returns up to eight active ad-network placements and four active in-flight sponsored campaigns with remaining budget. The response contains `videos` and `dailyRewardCap`; it does not return completed state, business date, or `videosCompletedToday`. |
| `POST /api/videos/complete` | Accepts `sourceType` (`ad_network` or `sponsored`) and `sourceId`. Sponsored views use the campaign's fixed `payoutPerView`; ad-network views are rejected until a verified callback exists. |

On an accepted sponsored completion, the controller counts today's completed watch logs, checks the configured cap (default 10), looks for an already rewarded matching source on the server-local calendar day, calculates the configured user/referrer shares, and commits revenue logs, watch logs, immutable ledger entries, wallet totals, and campaign spend in one MongoDB transaction. Reward ledger references and partial unique indexes are per user, source, and business date, preventing a repeated reward from posting twice. MongoDB must run as a replica set for this path.

Important limitations:

- The request does not include or validate `watchedDurationSeconds` or a server-issued `watchSessionId`; the backend cannot verify a full watch.
- There is no active `$25` starter-plan gate.
- Daily windows use the host server's local midnight rather than an explicitly configured business timezone.
- Full-watch validation and starter-plan gating remain absent.
- Transactions prevent partial multi-document reward writes, but simultaneous completions of different videos can still race the daily-cap count; serialize or otherwise atomically enforce that cap.
- The current response uses `userShare`, `referrerShare`, and `videosRemainingToday`, which differs from the example response in the requirements.

Production behavior should use server-issued watch sessions, verify actual provider callbacks for ad-network inventory, establish a stable business date, and atomically enforce one credited reward per qualifying session and daily limit. Client-supplied duration alone is not trustworthy proof of a full watch.

### Wallet And Transactions

| Method and path | Current behavior |
|---|---|
| `GET /api/wallet/balance` | Returns the mutable USD wallet document, including withdrawal-window timestamps, or a zero-valued fallback. |
| `GET /api/wallet/transactions` | Returns up to 100 completed video watch logs, 50 withdrawals, and 100 ledger entries. Ledger entries currently cover video/referral rewards only. |

Reward and starter-payment credits now create immutable, uniquely referenced ledger entries in the same transaction as their wallet increments. The wallet balance is still a mutable aggregate and is not yet calculated/reconciled from the ledger. Withdrawal and administrative adjustments are not yet posted to the ledger. Wallet amounts remain USD; the starter-payment record stores the INR quote and rate used for the order. Extend the ledger to every balance-changing operation, then add decimal-safe amounts, atomic balance reservation, and reconciliation before handling real money.

### Currency Quote

`GET /api/currency/usd-to-inr?amount=25` returns the requested USD amount, rounded INR equivalent, exchange rate, provider update time, and quote time. The rate source is configurable with `USD_INR_RATE_URL` and cached in-process for one hour. Invalid amounts return `400`; an unavailable or malformed provider response returns `503`. This endpoint does not place payment or payout orders. Treat its response as a quote only and persist the rate alongside any eventual gateway transaction so historical settlement amounts are reproducible.

### Razorpay Starter Payment

| Method and path | Current behavior |
|---|---|
| `POST /api/payments/create-order` | Authenticated and rate-limited. Requires `Idempotency-Key`, `{ "amount": 25, "method": "upi" }` or `{ "amount": 25, "method": "bank" }`; rejects prices other than the fixed `$25`. Saves the INR-paise amount and USD/INR quote before creating a Razorpay order. |
| `POST /api/payments/verify` | Authenticated and rate-limited. Verifies the checkout HMAC, fetches the payment from Razorpay, and requires a captured payment belonging to the saved order with the expected INR amount/currency. |
| `POST /api/payments/webhook` | Public provider endpoint. Validates `X-Razorpay-Signature` over the raw body and deduplicates `X-Razorpay-Event-Id`; handles `payment.captured` and `payment.failed`. |
| `GET /api/payments/:paymentId` | Authenticated; returns only the requesting user's payment status and amount details. |

On a verified capture, one MongoDB transaction adds a `$25` `PAYMENT` credit to the USD wallet, activates the user's starter plan, marks the payment paid, and records the webhook event when applicable. Unique provider IDs, request idempotency keys, event IDs, and a single-open-order index reduce duplicate processing. A second captured payment after starter activation is marked `DUPLICATE_PAID` for manual refund review; it is not credited again. Configure Razorpay to send `payment.captured` and `payment.failed` events to `/api/payments/webhook`.

Razorpay keys are read from `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. The key ID is returned to the client; the other secrets must remain server-side. The selected checkout method (`upi` or `bank`) is stored in payment/order notes; the frontend must still present the corresponding Razorpay Checkout method. The API returns Razorpay order parameters, not a hosted `checkoutUrl`.

Remaining verification: configure test credentials, create an order against Razorpay test mode, complete Checkout, deliver the webhook to a reachable development URL, verify replay behavior, and test duplicate/late capture handling. Do not use live credentials until these flows pass. The current automated tests cover signature utility behavior only.

### Referrals

`GET /api/referrals/stats` returns the user's referral code/link, total invites, pending/active counts, and aggregate `referralEarnings` from the wallet. Registration attributes a valid code to `referredBy`; invalid codes are silently ignored. The controller currently defines an active referral as one whose referred user has any `AdRevenueLog` event.

Referral codes are generated by `src/utils/generateReferralCode.js` and checked for uniqueness before user creation. The current code does not return a referral history list or explicit `PENDING`, `ACTIVE`, `PAID`, and `REJECTED` commission records. The video controller credits a configured referrer share when a referred user's accepted view is rewarded. Define and persist the qualifying event, commission policy, payout states, self-referral/abuse controls, and idempotency rules before calling referral earnings production-ready.

### Withdrawals

| Method and path | Current behavior |
|---|---|
| `POST /api/withdrawals/request` | Accepts `amount`; checks a configurable minimum and current available wallet amount, creates a `PENDING` withdrawal, and increments `pendingWithdrawal`. |
| `GET /api/withdrawals/history` | Returns the user's withdrawal records, newest first. |

The default minimum is `$50` in the wallet's USD denomination. When an atomic wallet credit moves available funds to the minimum, the wallet records `withdrawalWindowStartedAt` and `withdrawalRequestDeadlineAt`, seven days later. Additional credits do not extend an active window; a later credit opens a new window after the previous one has expired. `POST /api/withdrawals/request` rejects requests outside the window and returns the deadline. Existing eligible wallets without window timestamps are given a seven-day window when first submitting a request. An expected payout date and payout destination are not stored or returned. Reservation and withdrawal creation remain separate writes, so concurrent requests can overspend. Admin approval immediately changes status to `PAID` and deducts the wallet amount; rejection releases the pending amount. Implement atomic reservation, safe payout-destination handling, audit events, and clear `UNDER_REVIEW`/`APPROVED`/`PAID` transitions.

### Ad Callbacks

| Method and path | Current behavior |
|---|---|
| `POST /api/ad-callbacks/admob-ssv` | Always returns `501`; AdMob signature verification and callback persistence are TODOs. |
| `POST /api/ad-callbacks/unity-ads-ssv` | Checks an HMAC header, then returns `501`; verified revenue persistence and replay protection are TODOs. |

Do not enable ad-network rewards until callback signatures are verified according to each provider's official protocol, callback IDs/tokens are persisted idempotently, timestamps and replay are checked, and the completion path can look up the verified event. The current Unity signature comparison can throw for unequal-length buffers, so it also needs robust constant-time validation.

### Admin

`POST /api/admin/login` issues an admin-audience token signed with `JWT_ADMIN_SECRET`. Admin routes validate this audience and the database role; regular user tokens cannot pass admin middleware. User API routes accept only the user audience. Admin access/refresh sessions use the same rotation/reuse-detection flow, but retain the admin role.

Current admin API:

| Method and path | Purpose |
|---|---|
| `GET/POST /api/admin/videos` | List or create ad-network placement records |
| `PUT /api/admin/videos/:id` | Update a placement |
| `GET/POST /api/admin/sponsored-content` | List or create sponsored campaigns |
| `PUT /api/admin/sponsored-content/:id` | Update a campaign |
| `GET /api/admin/users` | List users, optionally filtering by `status` or case-insensitive email/mobile `search` |
| `PUT /api/admin/users/:id/status` | Set status to `ACTIVE` or `BLOCKED` |
| `GET /api/admin/ledger` | Aggregate logged ad revenue and configured user/referrer shares |
| `GET /api/admin/withdrawals?status=PENDING` | List withdrawals and populate basic user contact fields |
| `PUT /api/admin/withdrawals/:id` | Accept `{ "action": "APPROVE" }` or `{ "action": "REJECT", "rejectionReason": "..." }`; approval marks the record paid |
| `PUT /api/admin/settings/referral-share` | Returns `501`; settings persistence is not implemented |

`npm run create-admin` creates the first admin using `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Admin actions are not written to a dedicated audit log. Admin create/update handlers also pass request bodies directly into Mongoose and need allowlisted field validation.

## Frontend Requirement Coverage

| Frontend requirement | Backend support today | Work still required |
|---|---|---|
| R1: registration, verification, full video watch, referral importance | Registration, SMTP/Twilio OTP, verification, referral attribution, and completion endpoint exist | Configure delivery provider; full-watch verification; active-plan reward gating |
| R2: fixed `$25` start amount | Razorpay order and verified starter activation paths exist | Configure test keys; complete end-to-end gateway tests and refund/reconciliation operations |
| R3: wallet balance and immediate reward reflection | Balance endpoint, reward/payment credits, and wallet transaction listing exist | Ledger every balance change, reconcile aggregate wallet, and use decimal-safe accounting |
| R4: secure referral link | Referral code and link are returned | Use configured public URL, validate attribution rules, mitigate abuse |
| R5: referral amount status | Aggregate earnings and active/pending counts only | Individual commission records, status lifecycle, payout history |
| R6: 10 daily videos and immediate credit | Configurable server-side cap and sponsored reward credit exist | Full-watch proof, business timezone, race-safe cap and idempotent reward credit |
| R7: `$50` minimum and seven-day countdown | Withdrawal request/history exist | Correct default minimum, deadline and expected date, atomic reservation and payout workflow |
| R8: Help Center/support | No backend support API | Add a ticket/support integration only if the product needs requests persisted server-side |
| R9: About Us | No backend content API | Replace frontend temporary data with verified configuration/content if managed dynamically |
| R10: UPI or bank Add Money | Razorpay order, checkout verification, webhook, payment status, and one-time wallet credit exist | Test actual UPI/net-banking Checkout; add refunds/reconciliation and complete ledger coverage |

## Frontend Integration Contract Differences

Payment routes are mounted at `/api/payments`. Order creation requires an `Idempotency-Key` header in addition to `{ "amount": 25, "method": "upi" }`. The response returns Razorpay Checkout parameters (`keyId`, `orderId`, INR amount in paise, and currency), not a hosted checkout URL. The client must call `/api/payments/verify` with the Razorpay checkout signature; the webhook is the independent provider-confirmation path. `GET /api/payments/:paymentId` returns status.

Other response differences to align during integration:

- `/api/videos/daily` does not include completion progress or a business date.
- `/api/videos/complete` accepts only `sourceType` and `sourceId`; it does not accept the frontend's expected duration/session proof fields.
- `/api/wallet/transactions` returns `videoRewards`, `withdrawals`, and `ledgerEntries`; the ledger does not yet include payments or withdrawals.
- `/api/referrals/stats` omits referral history and per-referral earning status.
- Withdrawal records omit `submissionDeadline` and `expectedPayoutDate`.
- `/api/user/profile` exposes backend-confirmed `starterPlanActive` and `starterActivatedAt` fields.

Keep the frontend's local presentation state separate from financial truth. Do not infer payment success from returning to the app, local storage, or a client-supplied reward amount.

## Production Completion Plan

Recommended order, with money correctness and abuse prevention first:

1. **Define contracts and money policy.** Confirm currency, decimal precision, fixed starter product/price, business timezone, referral qualification/commission, and whether seven days means a request deadline or payout-review period. Document stable request/response schemas.
2. **Finish auth hardening.** Add shared schema validation and safe error responses, configure SMTP/Twilio in the deployment, add account recovery/MFA if required, restrict CORS, and audit privileged admin actions.
3. **Verify and complete payments.** Razorpay order creation, signature verification, webhook handling, and one-time starter activation are implemented. Configure test credentials and a reachable webhook URL; test expiry, retries, duplicate and late captures; add refunds and reconciliation before production.
4. **Make financial accounting authoritative.** The ledger covers video, referral, and starter-payment credits. Add immutable entries for withdrawal debits/refunds and administrative adjustments, decimal-safe amounts, and balance reconciliation. Migrate direct wallet mutations carefully.
5. **Secure video reward issuance.** Issue server-side watch sessions; verify actual completion/provider callbacks; establish timezone-aware daily windows; atomically enforce cap and deduplication; gate rewards on confirmed starter eligibility if that remains the product rule.
6. **Complete referrals.** Persist referral commission and status records, define activation and payout policy, prevent self-referrals and duplicate attribution, and make each commission idempotent.
7. **Complete withdrawals.** Enforce `$50` by default, atomically reserve available funds, store authoritative request/deadline/expected date, protect payout details, and model review versus actual payment correctly.
8. **Close admin and support gaps.** Validate admin writes, persist settings, add auditable transitions, and integrate support/content APIs only where the frontend needs backend-managed data.
9. **Add tests and operational controls.** Cover registration, OTP expiry, permissions, duplicate/concurrent callbacks, payment replay, ledger invariants, daily cap races, referral attribution, withdrawal minimum and reservation, and admin authorization. Add structured logs, metrics, backups, HTTPS, and deployment-secret management.

## Security And Reliability Gaps To Resolve

- `cors()` currently allows the default broad origin policy; production should allow only known frontend origins.
- Rate limiting is applied to auth routes, payment order/verification, and admin login. Callbacks, reward, referral, and withdrawal paths still need appropriate abuse protection.
- There is no general request body/schema validation, and some admin routes accept arbitrary request bodies.
- Error handlers/controllers sometimes return raw `err.message`; production responses should not reveal internal details.
- User/admin JWT signing secrets must be independently provisioned and rotated; current access tokens live 15 minutes and refresh tokens rotate, but there is no device/session management UI or administrative session-revocation workflow.
- OTP delivery is provider-backed but depends on SMTP/Twilio configuration. There is no provider failover or delivery monitoring; API responses do not disclose OTP values.
- Refresh tokens are returned in JSON for client-managed storage. Browser clients should use secure, HTTP-only cookie handling or another appropriately protected storage strategy.
- Financial operations span multiple non-transactional writes; duplicate or concurrent requests can leave inconsistent balances, logs, or campaign spend.
- Amounts use floating-point `Number`; use a decimal-safe representation and explicit currency/rounding rules.
- There is no general audit log, payment event store, idempotency-key store, or automated test suite.

## Acceptance Checklist

Before production integration, verify the acceptance criteria in [BACKEND_REQUIREMENTS.md](BACKEND_REQUIREMENTS.md), including:

- Verified users can register, verify OTP, and authenticate; admins cannot be accessed by regular users.
- A confirmed `$25` payment activates the starter plan once, and unconfirmed payments never credit a wallet.
- Wallet state reconciles from immutable entries and is consistent under retries/concurrent requests.
- Rewards require verified full watches, obey the timezone-defined daily cap, and cannot be duplicated.
- Referral attribution, qualification, commission, and status transitions are auditable and idempotent.
- Requests below `$50` are rejected; available balances cannot be withdrawn twice; server-supplied deadline dates drive the countdown.
- Every payment/ad callback is verified and replay-safe, and financial/admin state changes are auditable.
- Automated tests exercise normal, invalid, duplicate, and concurrent paths.