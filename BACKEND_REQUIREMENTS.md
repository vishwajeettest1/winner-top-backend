# StreamEarn Backend Requirements

This document defines the backend contract required to turn the current StreamEarn frontend prototype into a production-backed application.

## 1. Backend Responsibilities

The backend must be the source of truth for:

- Authentication and OTP verification
- User profiles and starter-plan activation
- Wallet balances and immutable ledger entries
- Payment orders and gateway verification
- Video catalog, daily limits, and reward eligibility
- Full-watch validation and idempotent reward credit
- Referral attribution, commissions, and statuses
- Withdrawal eligibility, seven-day deadlines, review, and payout status
- Support contact or ticket integration
- Admin authentication and content/user management

The frontend must never be trusted to create money, approve rewards, bypass daily limits, or confirm payments.

## 2. Environment and Security

Required server configuration should include:

```text
DATABASE_URL=
JWT_SECRET=
CLIENT_ORIGIN=
PAYMENT_PROVIDER=
PAYMENT_KEY_ID=
PAYMENT_KEY_SECRET=
PAYMENT_WEBHOOK_SECRET=
OTP_PROVIDER=
EMAIL_PROVIDER=
```

Security requirements:

- Hash passwords with a strong password-hashing algorithm.
- Use short-lived access tokens and refresh-token rotation where appropriate.
- Store user and admin tokens separately and enforce roles server-side.
- Validate every request body, query parameter, and identifier.
- Apply rate limits to login, registration, OTP, payment, reward, referral, and withdrawal endpoints.
- Verify payment signatures/webhooks only on the server.
- Never collect UPI PINs, bank passwords, or raw payment credentials.
- Use HTTPS in every non-local environment.
- Add audit logs for payment, wallet, reward, referral, admin, and withdrawal changes.
- Protect admin endpoints with role-based authorization, not only a hidden route.

## 3. Authentication APIs

### `POST /api/auth/register`

Request:

```json
{
  "mobileNumber": "9876543210",
  "email": "user@example.com",
  "password": "strong-password",
  "referralCode": "OPTIONAL-CODE"
}
```

Behavior:

- Validate unique email and mobile number.
- Hash the password.
- Create the user in an unverified state.
- Create and send an OTP with expiry and attempt limits.
- Attribute a valid referral code without paying commission yet.

Response:

```json
{
  "userId": "user-id",
  "message": "OTP sent"
}
```

Development OTPs must never be returned in production.

### `POST /api/auth/verify-otp`

Request:

```json
{
  "userId": "user-id",
  "otpCode": "123456"
}
```

Behavior:

- Validate OTP, expiry, and attempt count.
- Mark the account verified.
- Invalidate the OTP after use.
- Return an access token and safe user object.

### `POST /api/auth/login`

Request:

```json
{
  "email": "user@example.com",
  "password": "strong-password"
}
```

Return an access token only after password and account-status validation.

### `GET /api/user/profile`

Return safe profile data, including backend-confirmed starter status:

```json
{
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "mobileNumber": "9876543210",
    "starterPlanActive": false,
    "starterActivatedAt": null
  }
}
```

## 4. Payment and Starter Activation

### `POST /api/payments/create-order`

Authentication required.

Request:

```json
{
  "amount": 25,
  "method": "upi"
}
```

`method` must be `upi` or `bank`.

Behavior:

- Validate the amount and product being purchased.
- Create a payment order with the selected gateway.
- Store a pending payment record linked to the user and order ID.
- Do not activate the starter plan yet.

Response:

```json
{
  "paymentId": "payment-id",
  "orderId": "gateway-order-id",
  "checkoutUrl": "https://gateway.example/checkout"
}
```

### `POST /api/payments/webhook`

Unauthenticated gateway callback protected by webhook signature verification.

Behavior:

- Verify the gateway signature using the server secret.
- Process each gateway event idempotently.
- Mark the payment successful or failed.
- For a successful `$25` starter payment, activate the user’s starter plan exactly once.
- Create a wallet ledger entry only once.
- Never trust a client redirect as proof of payment.

Recommended payment states:

```text
CREATED, PENDING, PAID, FAILED, REFUNDED, CANCELLED
```

### Optional `GET /api/payments/:paymentId`

Return payment status so the frontend can show pending, successful, failed, or cancelled state after checkout.

### `GET /api/deposit-options/active`

Authentication required. Return only the currently active UPI deposit option configured by an administrator:

```json
{
  "option": {
    "id": "deposit-option-id",
    "displayName": "Main UPI",
    "upiId": "payments@examplebank",
    "qrCodeUrl": "https://cdn.example.com/payment-qr/option.png"
  }
}
```

Return `{ "option": null }` when no active option exists. Never accept the active option or UPI destination from an untrusted client as authoritative; resolve and validate it again when payment proof is submitted.

### `POST /api/payments/submit-proof`

Authentication required. Accept `multipart/form-data` from the manual UPI flow:

| Field | Type | Requirements |
|---|---|---|
| `depositOptionId` | String | Required; must identify the currently active option |
| `amount` | Decimal string | Required; validate against the minimum deposit and supported currency rules |
| `utrNumber` | String | Required; trim and validate format/length, reject duplicate transaction references |
| `paymentScreenshot` | File | Required PNG, JPEG, or WebP image, maximum 5 MB |

Validate the amount, authenticated user, active deposit option, file signature and image contents server-side. Store the screenshot in managed private storage and create a payment record with status `PENDING_REVIEW`. Return the pending record ID and status. Do not credit the wallet, mark the deposit paid, or activate the starter plan when the proof is submitted. An uploaded screenshot is supporting evidence, not payment verification.

### Admin review of UPI payment proofs

Add these administrator-only endpoints:

```text
GET   /api/admin/payments?status=ALL
PATCH /api/admin/payments/:id
```

`GET /api/admin/payments?status=ALL` returns every payment proof newest first; the endpoint may also accept an individual status filter. Each payment includes `id`, `user.email`, `amount`, `utrNumber`, `purpose`, `status`, and `createdAt`. Payment screenshots are served through the administrator-authenticated `GET /api/admin/payments/:id/screenshot` endpoint and must not be publicly accessible.

`PATCH /api/admin/payments/:id` accepts `{ "action": "REVIEW" }`, `{ "action": "CANCEL" }`, `{ "action": "APPROVE" }`, or the legacy `{ "action": "REJECT", "rejectionReason": "..." }`. `REVIEW` changes a pending proof to `UNDER_REVIEW`; `CANCEL` changes it to `CANCELLED`; neither credits the wallet. Before approval, an administrator must verify the UTR and received amount against authoritative UPI/bank records. Approval must atomically mark the payment approved and create exactly one wallet ledger credit; if it is a valid starter-plan payment, activate the starter plan in the same transaction. Record reviewer, decision time, reason, and audit event. Make decisions idempotent and prevent clients from changing payment status.

The frontend uses the active-option endpoint to display the QR and UPI ID, then submits the entered amount, UTR, and screenshot for review. Bank-account payments continue to use the payment-gateway checkout flow. Customer-facing history should include pending, approved, and rejected payment submissions with their statuses.

## 5. Wallet and Ledger

### `GET /api/wallet/balance`

Return calculated values from the ledger, not client storage:

```json
{
  "wallet": {
    "totalBalance": 25.0,
    "videoEarnings": 0.35,
    "referralEarnings": 0.0,
    "deposits": 25.0,
    "withdrawn": 0.0,
    "starterPlanActive": true,
    "starterActivatedAt": "2026-09-30T12:00:00.000Z"
  }
}
```

### `GET /api/wallet/transactions`

Return categorized ledger entries:

```json
{
  "deposits": [],
  "videoRewards": [],
  "referralRewards": [],
  "withdrawals": []
}
```

Ledger requirements:

- Use immutable entries with type, amount, direction, source, reference ID, status, and timestamps.
- Prevent duplicate entries using unique source/reference constraints.
- Never calculate a balance by adding a frontend starter amount.
- Use decimal-safe money storage, not binary floating-point arithmetic.
- Include manually submitted UPI payments in deposit history with `PENDING_REVIEW`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, or `CANCELLED` status; only approved payments create ledger credits.

## 6. Videos and Rewards

### `GET /api/videos/daily`

Return only eligible videos for the authenticated user:

```json
{
  "videos": [
    {
      "sourceType": "sponsored",
      "sourceId": "video-id",
      "title": "Reward video",
      "durationInSeconds": 45,
      "videoUrl": "https://cdn.example/video.mp4",
      "rewardAmount": 0.05,
      "completed": false
    }
  ],
  "dailyRewardCap": 10,
  "videosCompletedToday": 2,
  "businessDate": "2026-09-30"
}
```

Requirements:

- Maintain an admin-managed catalog of at least 10–12 active videos/campaigns.
- Return a stable business date and timezone.
- Mark already completed videos for the current business date.
- Require an active starter plan before rewardable viewing if that is the product rule.
- Do not use frontend fallback videos as production reward records.

### `POST /api/videos/complete`

Request:

```json
{
  "sourceType": "sponsored",
  "sourceId": "video-id",
  "watchedDurationSeconds": 45,
  "watchSessionId": "unique-session-id"
}
```

Server validation:

- Authenticate the user.
- Confirm the video is active and eligible.
- Confirm the user has an active starter plan if required.
- Confirm watched duration meets the video duration and allowed tolerance.
- Confirm the video has not already been rewarded for the user and business date.
- Enforce the daily limit of 10.
- Use an idempotency key or unique constraint to prevent duplicate rewards.
- Write the reward to the wallet ledger atomically.

Response:

```json
{
  "success": true,
  "userShare": 0.05,
  "videosCompletedToday": 3,
  "remainingToday": 7
}
```

## 7. Referrals

### `GET /api/referrals/stats`

Return:

```json
{
  "referralLink": "https://app.example/register?ref=CODE",
  "referralCode": "CODE",
  "totalInvites": 3,
  "activeReferrals": 1,
  "pendingReferrals": 1,
  "totalReferralEarnings": 36.5,
  "referralHistory": []
}
```

Requirements:

- Generate unique, non-guessable referral codes.
- Attribute the referral at registration or first verified account creation.
- Define the qualifying event for an active referral.
- Define commission percentage/amount and maximum payout rules.
- Prevent self-referrals, duplicate attribution, and circular abuse.
- Use statuses such as `PENDING`, `ACTIVE`, `PAID`, and `REJECTED`.
- Create referral wallet entries only when the qualifying event is confirmed.

## 8. Withdrawals

### `POST /api/withdrawals/request`

Authentication required.

Request:

```json
{
  "amount": 50
}
```

Rules:

- Enforce a minimum withdrawal amount of `$50.00`.
- Confirm available balance from the server ledger.
- Prevent spending the same balance twice.
- Create a pending withdrawal with an authoritative `requestedAt` and deadline.
- Store the selected payout destination securely. Do not store secrets in plaintext.

### `GET /api/withdrawals/history`

Return:

```json
{
  "withdrawals": [
    {
      "id": "withdrawal-id",
      "amount": 50.0,
      "status": "PENDING",
      "requestedAt": "2026-09-30T12:00:00.000Z",
      "submissionDeadline": "2026-10-07T12:00:00.000Z",
      "expectedPayoutDate": "2026-10-07T12:00:00.000Z"
    }
  ]
}
```

Recommended statuses:

```text
PENDING, UNDER_REVIEW, APPROVED, PAID, REJECTED, CANCELLED
```

The server must define whether the seven-day period is a submission deadline or a payout-review period. The frontend displays the dates supplied by the backend.

## 9. Admin APIs

Admin login and all admin APIs must use a separate admin token and role check.

Required capabilities:

- Create, update, activate, and deactivate videos/campaigns.
- Set reward amounts and video durations.
- View and manage users.
- Review, approve, reject, and mark withdrawals paid.
- Review payments and refunds.
- View wallet and audit history.
- Configure verified About Us, support, and social-profile content.

Suggested endpoints:

```text
POST   /api/admin/login
GET    /api/admin/ledger
GET    /api/admin/users
PATCH  /api/admin/users/:id/status
GET    /api/admin/withdrawals
PATCH  /api/admin/withdrawals/:id
GET    /api/admin/videos
POST   /api/admin/videos
PATCH  /api/admin/videos/:id
POST   /api/admin/videos/upload
GET    /api/admin/sponsored-content
POST   /api/admin/campaigns
PATCH  /api/admin/campaigns/:id
GET    /api/admin/deposit-options
POST   /api/admin/deposit-options
PATCH  /api/admin/deposit-options/:id/active
GET    /api/admin/payments?status=PENDING_REVIEW
PATCH  /api/admin/payments/:id
```

### Video file upload

`POST /api/admin/videos/upload` must accept `multipart/form-data` with these fields:

| Field | Type | Description |
|---|---|---|
| `video` | File | MP4, WebM, or QuickTime video to store in managed object storage |
| `title` | String | Admin-visible and user-visible video title |
| `durationInSeconds` | Number | Expected playback duration |
| `rewardAmount` | Number | Reward configured for an eligible completion |

The endpoint must authenticate an administrator, enforce configured file-size and media limits, validate the actual file type rather than trusting its filename, store the asset outside the application process, and return the created video record. The frontend cannot provide durable uploads until this API and media storage are implemented.

### Admin overview and content management

- `GET /api/admin/ledger` returns the financial summary used by the admin overview.
- `GET /api/admin/videos` and `GET /api/admin/sponsored-content` return their `videos` and `campaigns` arrays respectively.
- `PATCH /api/admin/videos/:id` and `PATCH /api/admin/campaigns/:id` accept validated changes such as `isActive`.
- `PATCH /api/admin/withdrawals/:id` accepts the documented review action and optional transaction reference.
- Payment review/refund, audit history, and editable support/About content are required operational capabilities but do not yet have frontend routes or API contracts in this project.

### Admin deposit options

The admin deposit page reads and manages UPI payment options using these endpoints:

#### `GET /api/admin/deposit-options`

Require an administrator token. Return options with the active option first:

```json
{
  "options": [
    {
      "id": "deposit-option-id",
      "displayName": "Main UPI",
      "upiId": "payments@examplebank",
      "qrCodeUrl": "https://cdn.example.com/payment-qr/option.png",
      "isActive": true,
      "createdAt": "2026-10-01T12:00:00.000Z"
    }
  ]
}
```

#### `POST /api/admin/deposit-options`

Require an administrator token and accept `multipart/form-data`:

| Field | Type | Requirements |
|---|---|---|
| `displayName` | String | Required, trimmed, maximum 60 characters |
| `upiId` | String | Required, trimmed, validated UPI address, maximum 120 characters |
| `qrCode` | File | Required PNG, JPEG, or WebP image, maximum 5 MB |

Allow administrators to store up to 10 QR options. Store each QR image in managed object storage, validate its actual file signature and image contents (not just the supplied MIME type or filename), and return the created option. New options must default to inactive and must not displace the current active option.

#### `PATCH /api/admin/deposit-options/:id/active`

Require an administrator token and accept `{ "isActive": true }` to select an option. The backend must atomically deactivate every other option and activate the requested option in the same transaction. Enforce the single-active invariant in persistent storage as well, so concurrent requests cannot leave multiple active options. `{ "isActive": false }` may deactivate the selected option, leaving no active option.

The admin frontend fetches the list on page load and after mutations. All changes must be persisted by the API; frontend radio selection alone is not authoritative. Customer payment creation must use only the server-side active option, and a QR display or client redirect must never be treated as payment confirmation. Do not store UPI PINs, bank passwords, or other customer payment credentials.

For frontend-only local testing, when these endpoints return `404`, the application can store uploaded QR images and submitted proof files in the current browser's IndexedDB. This local demo data is not shared between devices or users and is not production storage. A local demo approval must never change a wallet balance; production payment verification and ledger credit require the administrator API and server-side records above.

## 10. Support and About Content

Support data should come from verified configuration, not hard-coded placeholders:

- Support email
- Helpline number and hours
- FAQ content
- Founder and team profiles
- Approved photos and biographies
- Official Instagram, Facebook, YouTube, and Twitter/X URLs
- Verified milestones and statistics

## 11. Acceptance Criteria

The backend is ready for production integration when:

- A user can register, verify OTP, and log in securely.
- Payment success activates the `$25` starter plan exactly once.
- Wallet balances are ledger-backed and consistent across devices.
- Only full eligible video watches can create one reward per video/day.
- The daily cap is enforced server-side.
- Referral commissions are attributed and paid according to documented rules.
- A withdrawal below `$50` is rejected server-side.
- Withdrawal deadlines and expected payout dates come from the server.
- Admin routes reject non-admin users.
- Payment webhooks are signature-verified and idempotent.
- All money and status changes are auditable.
- Automated tests cover authentication, payments, ledger entries, rewards, referrals, and withdrawals.
