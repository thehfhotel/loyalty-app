# Public-Launch Plan — LINE OA integration + real-customer readiness

Decision record from the 2026-07-09 design session. Domain language lives in
[`CONTEXT.md`](../CONTEXT.md); the three one-way-door decisions are ADRs
[0001](adr/0001-one-program-across-properties.md) ·
[0002](adr/0002-line-channels-single-provider.md) ·
[0003](adr/0003-booking-channel-into-pms.md).

**Launch shape: big bang.** One public date, both OAs simultaneously, with
the loyalty core **and** live booking. The date is gated by **all six** open
items in [`public-launch-readiness.md`](public-launch-readiness.md)
(backups + restore drill, capacity test, PDPA doc, status page, support
email, on-call).

## Decisions at a glance

| Area | Decision |
| --- | --- |
| Program | One program, both properties; tier from total nights (ADR-0001) |
| LINE scope | LIFF front door + push messages; no chatbot |
| Providers | All channels under the Login channel's provider (ADR-0002) |
| Push routing | Property-affinity; per-OA friendships via follow/unfollow webhooks |
| Enrollment | Silent auto-enroll on first LIFF open; no consent screen |
| PDPA basis | Membership = contract; OA friendship = messaging opt-in; notice link in footer/rich menu |
| CRM link | Member QR scanned at desk (primary) + optional phone field for staff search |
| Accrual | PMS calls loyalty API on checkout; idempotent by PMS stay ID |
| Booking | Channel into PMS, no local inventory (ADR-0003) |
| Payment | 50% deposit or full (guest's choice); per-property PromptPay accounts; slip verification; auto-release unpaid |
| Coupons | Program-wide by default; optional single-property restriction |

## Locked interface contracts

Agree these before any parallel implementation; drift here is the main
rework risk.

### PMS → loyalty (accrual, new endpoint in this repo)

```
POST /api/loyalty/stays          auth: Authorization: Bearer <LOYALTY_SERVICE_TOKEN>
{
  "pms_stay_id": "…",            // idempotency key — replays return 200 with same result
  "membership_id": "…",          // from the Link (QR scan / phone search)
  "property": "hf" | "hfville",
  "check_in": "YYYY-MM-DD",
  "check_out": "YYYY-MM-DD",
  "nights": 2
}
```

### Loyalty → PMS (booking channel, new endpoints in new-hotel)

```
GET  /api/channel/availability?property&check_in&check_out&guests
     → room types with nightly prices and bookable counts
POST /api/channel/bookings
     Idempotency-Key: <1..255 printable ASCII>   — scoped per caller token +
                                                   property (new-hotel #305)
     { property, room_type, check_in, check_out, guest{name,phone},
       membership_id?, payment: "deposit50" | "full" }
     → { pms_booking_id, total, amount_due_now, hold_expires_at }
       replay of a stored key → the same body + `Idempotency-Replayed: true`
       same key, different body → 422
POST /api/channel/bookings/{pms_booking_id}/payment-verified
     { "amount": <THB received> }   — required: the PMS doesn't persist the
                                      guest's deposit50/full choice
POST /api/channel/bookings/{pms_booking_id}/release            (hold expired)
```

#### Who mints the hold-create idempotency key (A16)

**The browser does, once per booking attempt.** A key only earns its keep
when a *retry of one attempt* carries the same value, and a key minted
server-side per HTTP request cannot do that — the retry is a second request
and would get a second key, so the PMS would see two unrelated creates and
hold two rooms.

`frontend/src/services/channelBookingService.ts` therefore mints a UUID v4
per `createBooking()` call and sends it as `Idempotency-Key`. That value
survives the one retry this app really performs: `axiosInterceptor` replays
`error.config` — the same object, headers included — after a 401 refresh.
(It was worth checking: the booking mutation itself does **not** retry, so
the 401 replay is the whole client-side retry surface today.)

`routes::bookings::create_channel_booking` accepts that header (and an
`idempotencyKey` body field, for a caller that cannot set headers), and
**mints its own UUID v4 when neither is present** — an older bundle still
live in a guest's LIFF webview, a curl from the desk. A server-minted key
gives those callers everything except cross-request replay: a duplicate
*delivery* of one request still collapses. Sending no key at all would be
strictly worse, and there is no third option. A malformed client key is
warned about and replaced rather than rejected, because a client bug must
not read as "your booking failed" to a guest who did nothing wrong.

The app's own one-in-flight Redis hold guard still runs alongside it, behind
`PMS_HOLD_GUARD` (default **on**). That flag is the retirement lever: once
the keyed path has run in production long enough to trust, set it to `false`
to drop the lock without a deploy. It does not turn idempotency off — the
key is sent either way.

Implementation notes from the PMS side (feat/loyalty-channel in new-hotel):
`pms_booking_id` is `"{hf|hfville}-{book_id}"` (per-site DBs have
overlapping serials); the whole `/api/channel/*` surface ships dark behind
`LOYALTY_CHANNEL_ENABLED` + `LOYALTY_CHANNEL_TOKEN`, and the checkout hook
behind `LOYALTY_APP_URL` + `LOYALTY_SERVICE_TOKEN`. Deposits are not
mirrored to legacy iHOTEL (no validated writeback recipe) — iHOTEL shows
deposit 0 until checkout; tentative holds DO write back immediately so
reception can't double-book during the payment window.

New-hotel work goes through the coexistence guardrails (dual-write /
iHOTEL writeback is that repo's problem, not this one's).

### LINE surface (new endpoints in this repo)

```
POST /api/line/webhook/{property}   — signature-verified per channel secret;
                                      handles follow / unfollow → friendships
POST /api/auth/liff                 — body {id_token}; verifies with LINE,
                                      silent-enrolls or matches provider_user_id,
                                      issues the normal JWT cookie pair
```

### Config (env names)

```
LINE_MESSAGING_HF_ACCESS_TOKEN / LINE_MESSAGING_HF_CHANNEL_SECRET
LINE_MESSAGING_HFVILLE_ACCESS_TOKEN / LINE_MESSAGING_HFVILLE_CHANNEL_SECRET
LIFF_ID
LOYALTY_SERVICE_TOKEN               (shared with new-hotel)
PROMPTPAY_HF_ID / PROMPTPAY_HFVILLE_ID   (per-property receiving accounts)
```

## Workstream 1 — loyalty-app backend

1. **Property foundation** — `property` enum (`hf` | `hfville`); columns on
   points transactions, coupons (nullable restriction), bookings; new
   `stays` table (accrual records, unique on `pms_stay_id`); new
   `line_friendships` table (member, property/OA, followed_at, unfollowed_at).
2. **Stay accrual endpoint** — `POST /api/loyalty/stays` (service token,
   idempotent), awards points + nights via existing stored procedures,
   emits the "you earned" push.
3. **LIFF auth** — `POST /api/auth/liff`: LINE ID-token verification,
   silent enroll (reuses `process_line_auth` linkage by `provider_user_id`),
   JWT cookies as today.
4. **Webhooks + push service** — per-property webhook route with signature
   verification; push sender with property-affinity routing (event property →
   that OA if friended → fallback other friended OA → no push).
5. **Coupon property restriction** — nullable property on coupon +
   redemption-time check.
6. **Booking channel rework** — replace local-inventory search/confirm with
   the PMS channel API; local room tables become display catalog keyed by
   property + PMS room type; per-property PromptPay intent (50% / full),
   slip verification marks PMS booking paid; expiry job calls release.

## Workstream 2 — loyalty-app frontend

1. **LIFF bootstrap** — detect LIFF context, `liff.getIDToken()` →
   `/api/auth/liff`, no login wall inside LINE.
2. **Member QR screen** — membership ID as QR, one tap from home (the desk
   handshake that creates the Link).
3. **Optional phone field** on profile (staff-search assist).
4. **Property-aware booking UI** — property picker, catalog, deposit-or-full
   choice, per-property PromptPay QR, slip upload (exists), balance-due copy.
5. **Privacy-notice link** in footer (PDPA position).

## Workstream 3 — new-hotel (PMS)

1. Channel API: availability, create-booking (with hold + expiry),
   payment-verified, release.
2. Guest-profile Link: store `membership_id` on guest profile; QR-scan and
   phone-search flows at the desk.
3. Checkout hook: on checkout of a linked guest, call
   `POST /api/loyalty/stays` (retry on failure; reconciliation sweep is a
   post-launch backstop).

## Workstream 4 — LINE console + ops (owner: Winut — I can't do these)

1. Enable Messaging API on both OAs **choosing the existing Login channel's
   provider** (ADR-0002 — irreversible if done wrong).
2. Register the LIFF app on the Login channel; set endpoint URL.
3. Rich menus for both OAs (same LIFF link; "Book" tile).
4. Wire the new env secrets (tokens above) into deploy secrets.

## Readiness gate (all six block the date)

| Item | Owner |
| --- | --- |
| Backup secrets in GitHub Actions | Winut |
| Restore drill performed + documented | Winut (guided) |
| Capacity test incl. booking/availability path | repo |
| PDPA doc (friendship-as-opt-in position) | repo |
| Status page | Winut picks host; repo wires |
| Support email + on-call rotation | Winut |

## Ordering

W1.1 (property foundation) unblocks everything backend. W1.2–W1.5 and W2
proceed in parallel after it. W1.6 + W2.4 wait on W3.1 (channel API) —
start W3 early. W4.1–2 are needed before any LIFF testing; do them first.

## Deliberately deferred (post-launch)

- Reconciliation sweep (PMS checkouts vs awarded stays)
- Admin merge tool for duplicate members (email-registered member also
  silently enrolled via LIFF)
- In-chat bot replies (explicitly out of scope)
- `booking_audit_log` retention revisit (tracked in readiness doc)
