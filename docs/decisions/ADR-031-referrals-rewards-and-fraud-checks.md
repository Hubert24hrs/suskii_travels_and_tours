# ADR-031: Referrals, rewards and fraud checks

- Status: Accepted
- Date: 2026-10-05
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec asks for referral codes, a "reward credit on referee's first completed trip", the wallet
as the place rewards land, and "fraud checks on self-referrals" using "device fingerprint hash,
phone/email reuse". Reward amounts are not decided. Paying a reward is a money movement and must
go through the ledger (ADR-017).

## Decisions

1. **Codes.** Every account gets one referral code on first request (8 characters from the
   voucher alphabet, no look-alikes), unique, stored in `referral_codes`. Codes can be disabled
   by staff.
2. **Attribution.** Registration (password, OTP or social) may carry a `referralCode`. A
   `referrals` row links referrer and referee with status `pending` and the signals captured at
   sign-up: HMACs (purpose `referral-signal`) of the referee's email, phone, network (IP /24 or
   IPv6 /48) and device (mobile attestation key id or the web client hint); nothing reversible.
   A code typed later than sign-up does not count, and an account can be referred once.
3. **Qualification.** The referral qualifies when the referee's first booking reaches CONFIRMED
   and its travel date has passed (the "completed trip"), with a minimum spend
   (`REFERRAL_MIN_SPEND_MINOR`) and not a Prime purchase. A worker sweep checks pending referrals.
4. **Fraud checks** run at attribution and again at qualification; any hit moves the referral to
   `review` (never an automatic payout):
   - the referee's email, phone or payment card fingerprint matches the referrer's (self-referral);
   - the same device or network as the referrer within 30 days;
   - a disposable email domain (maintained list);
   - the referrer exceeded `REFERRAL_MONTHLY_CAP` qualified referrals this month;
   - the referee's booking was refunded or cancelled (then `rejected`).
     Staff approve or reject reviews through admin routes (`referrals:review`), audited.
5. **Rewards.** `REFERRAL_REWARD_REFERRER_MINOR`, `REFERRAL_REWARD_REFEREE_MINOR` and
   `REFERRAL_REWARD_CURRENCY` set the amounts; both default to zero, so referrals are tracked and
   shown but pay nothing until the owner chooses amounts. A payout posts one ledger transaction
   (idempotency key `referral:{id}:reward`) from a new `promotions` expense account to each
   wallet; wallet balances are spendable at checkout (phase 6).

## Consequences

- No reward can be paid twice (ledger idempotency) or without passing the checks.
- Referral performance is visible before the owner commits money to it.
- Card fingerprints come from providers that expose them (Paystack, Flutterwave, Stripe); the mock
  provider supplies a deterministic one for tests.
