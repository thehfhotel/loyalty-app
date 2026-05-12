# Admin backend gaps

These admin pages are wired up on the frontend but call Rust backend
endpoints that don't exist yet. Each entry lists the frontend `file:line`
of the call site and the route path the frontend currently expects.

The frontend renders a stub (empty data, disabled action, or a
"feature is being migrated" message) where the endpoint is missing, so
existing components don't crash. The pages are still reachable from the
admin nav.

When implementing these, mount under `/api/admin/...` in
`backend-rust/src/routes/admin.rs` (or a dedicated submodule if the surface
grows). Request/response shapes will be defined as part of the implementing
PR, alongside the route handlers and integration tests.

## Status legend

- **Missing** — no Rust handler exists; frontend renders a stub.
- **Partial** — a related public/booking endpoint exists but no
  admin-scoped variant.
- **Implemented** — handler shipped; frontend will pick it up the next
  time the page mounts.

## Progress

- Batch 1 (`feat/admin-endpoints-batch-1`): 5 of 35 endpoints implemented
  (room types list, rooms list, blocked-dates list/create/delete). All
  five are pure reads/writes against tables that already exist in the
  schema.
- Batch 2 (`feat/admin-booking-management`): 6 endpoints implemented
  (admin bookings list/detail/edit/discount/cancel + room-types
  dropdown). Required a schema migration that added `discount_amount`,
  `discount_reason`, `admin_notes`, `payment_type`, `payment_amount`
  columns to `bookings` and introduced a new `booking_audit_log` table —
  every state change writes an audit row in the same transaction.
- Misc batch (`feat/admin-misc-endpoints`): 4 more endpoints implemented
  (email status, email test-send, slip verify, slip needs-action). Email
  test does not loop back through IMAP — see the email-service section
  below for the deliberate scope reduction. Email-change verification
  was deferred to its own PR because it also needs an initiator
  (`PUT /api/users/email`) plus a schema migration; shipping verify/resend
  alone would be a half-flow.
- Room writes (`feat/admin-room-writes`): +6 endpoints
  (POST/PATCH/DELETE on `/room-types` and `/rooms`). Adds the
  `20260512000000_room_management_columns.sql` migration with
  `room_types.bed_type/amenities/images/sort_order` and `rooms.notes`.

Total implemented: 21 of 35. Remaining: 14 endpoints.

---

## /api/admin/bookings — admin booking management

Used by the booking management table, slip viewer, and edit modal.

- [x] `GET /api/admin/bookings` — list with filters and counts.
  Frontend: `frontend/src/pages/admin/BookingManagement.tsx:125`. Status: Implemented (batch 2).
- `POST /api/admin/bookings/:id/verify-slip` — legacy single-slip verification.
  Frontend: `frontend/src/pages/admin/BookingManagement.tsx:161`. Status: Missing.
- `POST /api/admin/bookings/:id/needs-action` — mark primary slip as needing action.
  Frontend: `frontend/src/pages/admin/BookingManagement.tsx:182`. Status: Missing.
- [x] `POST /api/admin/bookings/slips/:slipId/verify` — multi-slip per-slip verification.
  Frontend: `frontend/src/components/admin/SlipViewerSidebar.tsx:131`. Status: Implemented (misc batch).
- [x] `POST /api/admin/bookings/slips/:slipId/needs-action` — multi-slip per-slip "needs action".
  Frontend: `frontend/src/components/admin/SlipViewerSidebar.tsx:145`. Status: Implemented (misc batch).
- [x] `PUT /api/admin/bookings/:id` — edit a booking.
  Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:128`. Status: Implemented (batch 2).
- [x] `POST /api/admin/bookings/:id/discount` — apply a discount.
  Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:144`. Status: Implemented (batch 2).
- [x] `POST /api/admin/bookings/:id/cancel` — admin cancel.
  Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:160`. Status: Implemented (batch 2).
- [x] `GET /api/admin/bookings/room-types` — dropdown source for the edit modal.
  Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:119`. Status: Implemented (batch 2).
- [x] `GET /api/admin/bookings/:id` — full booking detail + audit history.
  Frontend: paired with `PUT /:id` for the edit modal refresh. Status: Implemented (batch 2).

### Follow-ups surfaced by batch 2

- The frontend's `BookingEditModal.tsx` can in principle send fields the
  schema doesn't model (e.g. a `roomChanges: [...]` array for moving rooms
  mid-stay). The PUT handler ignores any field that isn't in its allow-list
  (`checkInDate`, `checkOutDate`, `numberOfGuests`, `roomTypeId`, `notes`,
  `adminNotes`, `totalPrice`); the modal currently doesn't expose those
  unsupported fields, so this is latent rather than user-visible.
- The single-slip `verify-slip` / `needs-action` endpoints on
  `/api/admin/bookings/:id/...` are still missing; the multi-slip
  per-slip variants are covered by the misc batch.

// shape TBD during implementation

---

## /api/admin/room-types — room-type CRUD

Used by `RoomTypeManagement.tsx`. The current backend models room type as a
hard-coded enum; implementing CRUD requires a `room_types` table and
migrating bookings to reference a UUID rather than the enum.

- [x] `GET /api/admin/room-types` — list room types.
  Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:82`,
  `frontend/src/pages/admin/RoomAvailability.tsx:68`,
  `frontend/src/pages/admin/RoomManagement.tsx:61`. Status: Implemented (batch 1).
- [x] `POST /api/admin/room-types` — create. Returns 201 with the new row;
  409 when the name (case-insensitive) is already taken.
  Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:90`. Status: Implemented (room writes PR).
- [x] `PATCH /api/admin/room-types/:id` — partial update; only fields in the
  body are touched. 404 when the id is unknown.
  Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:106`. Status: Implemented (room writes PR).
- [x] `DELETE /api/admin/room-types/:id` — delete; returns 409 with
  `{ roomsAttached: <n> }` when one or more rooms still reference the type,
  so admins must reassign or delete the rooms first.
  Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:123`. Status: Implemented (room writes PR).

// shape TBD during implementation

---

## /api/admin/rooms — physical room CRUD

Used by `RoomManagement.tsx`. Requires a `rooms` table.

- [x] `GET /api/admin/rooms` — list.
  Frontend: `frontend/src/pages/admin/RoomManagement.tsx:70`,
  `frontend/src/pages/admin/RoomAvailability.tsx:80`. Status: Implemented (batch 1).
- [x] `POST /api/admin/rooms` — create. Returns 201; 404 when `roomTypeId`
  is unknown; 409 when `roomNumber` is already taken.
  Frontend: `frontend/src/pages/admin/RoomManagement.tsx:78`. Status: Implemented (room writes PR).
- [x] `PATCH /api/admin/rooms/:id` — partial update; only fields in the body
  are touched. 404 when the id is unknown.
  Frontend: `frontend/src/pages/admin/RoomManagement.tsx:94`. Status: Implemented (room writes PR).
- [x] `DELETE /api/admin/rooms/:id` — hard delete (cascades to blocked-dates
  and bookings via FK).
  Frontend: `frontend/src/pages/admin/RoomManagement.tsx:111`. Status: Implemented (room writes PR).

// shape TBD during implementation

---

## /api/admin/blocked-dates — calendar availability blocks

Used by `RoomAvailability.tsx` to block specific room/date combinations.
The booking module already reads from `room_blocked_dates`, but no
admin-write endpoints exist.

- [x] `GET /api/admin/blocked-dates` — list blocks for a date range.
  Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:102`. Status: Implemented (batch 1).
- `GET /api/admin/bookings/calendar` — room-level booking grid.
  Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:111`. Status: Missing.
- [x] `POST /api/admin/blocked-dates` — block dates.
  Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:119`. Status: Implemented (batch 1).
- [x] `DELETE /api/admin/blocked-dates` — unblock dates.
  Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:137`. Status: Implemented (batch 1).

// shape TBD during implementation

---

## /api/admin/email — email service health and test harness

Used by `EmailServicePage.tsx` (Settings → Email Service).

- [x] `GET /api/admin/email/status` — current SMTP/IMAP status.
  Frontend: `frontend/src/pages/admin/EmailServicePage.tsx:36`. Status: Implemented (misc batch).
  Returns real SMTP probe (`lettre::test_connection`). IMAP is reported
  as configured-state only — see note below.
- [x] `POST /api/admin/email/test` — SMTP send test.
  Frontend: `frontend/src/pages/admin/EmailServicePage.tsx:44`. Status: Implemented (misc batch).
  **Reduced scope:** sends a real test email via SMTP and reports
  `smtpSent`/`messageId`/`deliveryTimeMs`. Does **not** loop back through
  IMAP to verify receipt — see "Skipped" below. `imapReceived` is always
  `null` in the response. The frontend's `TestResult` interface already
  tolerates this.

### Skipped in misc batch

- **IMAP live probe** for `GET /email/status` — the `async-imap` crate
  is already in `Cargo.toml` but unused; building a probe needs a new
  `ImapService` trait + impl (parallel to `EmailService`) and live
  IMAP test infrastructure to exercise it. Kept out of this PR to
  bound scope. The endpoint reports `imapConnected` based on whether
  `IMAP_HOST/USER/PASS` are set, and exposes `imapProbed: false` so
  the frontend can distinguish "configured-but-unprobed" from
  "probed-and-healthy".
- **SMTP→IMAP loopback** for `POST /email/test` — same blocker. The
  loopback would queue a known-token message, poll the IMAP inbox for
  it (with a timeout + cleanup), then mark `imapReceived: true`. Worth
  doing in the IMAP-service PR alongside the probe.

---

## /api/users/me/email/verify — change-email verification

Used by `EmailVerificationModal.tsx` (Profile page → change email flow).

- `POST /api/users/me/email/verify` — confirm a verification code.
  Frontend: `frontend/src/components/profile/EmailVerificationModal.tsx:28`. Status: Missing.
- `POST /api/users/me/email/verify/resend` — resend the verification email.
  Frontend: `frontend/src/components/profile/EmailVerificationModal.tsx:42`. Status: Missing.

**Note (misc batch):** deliberately not landed in this PR. The full flow
also requires a new `PUT /api/users/email` initiator (currently 404s in
the Rust backend — the frontend service calls it but the modal is not
reachable, per priority 6 in the rollout order below). Implementing
verify/resend without the initiator would be a half-flow. Tracked for a
dedicated user-routes PR that owns the schema migration
(`email_verification_tokens`) plus all three endpoints together.

// shape TBD during implementation

---

## Suggested rollout order

1. Room types CRUD + rooms CRUD (everything else depends on these).
2. Blocked dates + admin booking calendar.
3. Admin booking listing, edit, discount, cancel.
4. Multi-slip + legacy slip verification.
5. Email service status + test harness.
6. Email change verification (lower priority — profile flow currently works
   without it; the modal just isn't reachable).
