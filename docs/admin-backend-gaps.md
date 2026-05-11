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

---

## /api/admin/bookings — admin booking management

Used by the booking management table, slip viewer, and edit modal.

- `GET /api/admin/bookings` — list with filters and counts.
  Frontend: `frontend/src/pages/admin/BookingManagement.tsx:125`. Status: Missing.
- `POST /api/admin/bookings/:id/verify-slip` — legacy single-slip verification.
  Frontend: `frontend/src/pages/admin/BookingManagement.tsx:161`. Status: Missing.
- `POST /api/admin/bookings/:id/needs-action` — mark primary slip as needing action.
  Frontend: `frontend/src/pages/admin/BookingManagement.tsx:182`. Status: Missing.
- `POST /api/admin/bookings/slips/:slipId/verify` — multi-slip per-slip verification.
  Frontend: `frontend/src/components/admin/SlipViewerSidebar.tsx:131`. Status: Missing.
- `POST /api/admin/bookings/slips/:slipId/needs-action` — multi-slip per-slip "needs action".
  Frontend: `frontend/src/components/admin/SlipViewerSidebar.tsx:145`. Status: Missing.
- `PUT /api/admin/bookings/:id` — edit a booking.
  Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:128`. Status: Missing.
- `POST /api/admin/bookings/:id/discount` — apply a discount.
  Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:144`. Status: Missing.
- `POST /api/admin/bookings/:id/cancel` — admin cancel.
  Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:160`. Status: Partial.
- `GET /api/admin/bookings/room-types` — dropdown source for the edit modal.
  Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:119`. Status: Missing.

// shape TBD during implementation

---

## /api/admin/room-types — room-type CRUD

Used by `RoomTypeManagement.tsx`. The current backend models room type as a
hard-coded enum; implementing CRUD requires a `room_types` table and
migrating bookings to reference a UUID rather than the enum.

- `GET /api/admin/room-types` — list room types.
  Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:82`,
  `frontend/src/pages/admin/RoomAvailability.tsx:68`,
  `frontend/src/pages/admin/RoomManagement.tsx:61`. Status: Missing.
- `POST /api/admin/room-types` — create.
  Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:90`. Status: Missing.
- `PUT /api/admin/room-types/:id` — update.
  Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:106`. Status: Missing.
- `DELETE /api/admin/room-types/:id` — delete.
  Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:123`. Status: Missing.

// shape TBD during implementation

---

## /api/admin/rooms — physical room CRUD

Used by `RoomManagement.tsx`. Requires a `rooms` table.

- `GET /api/admin/rooms` — list.
  Frontend: `frontend/src/pages/admin/RoomManagement.tsx:70`,
  `frontend/src/pages/admin/RoomAvailability.tsx:80`. Status: Missing.
- `POST /api/admin/rooms` — create.
  Frontend: `frontend/src/pages/admin/RoomManagement.tsx:78`. Status: Missing.
- `PUT /api/admin/rooms/:id` — update.
  Frontend: `frontend/src/pages/admin/RoomManagement.tsx:94`. Status: Missing.
- `DELETE /api/admin/rooms/:id` — delete.
  Frontend: `frontend/src/pages/admin/RoomManagement.tsx:111`. Status: Missing.

// shape TBD during implementation

---

## /api/admin/blocked-dates — calendar availability blocks

Used by `RoomAvailability.tsx` to block specific room/date combinations.
The booking module already reads from `room_blocked_dates`, but no
admin-write endpoints exist.

- `GET /api/admin/blocked-dates` — list blocks for a date range.
  Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:102`. Status: Missing.
- `GET /api/admin/bookings/calendar` — room-level booking grid.
  Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:111`. Status: Missing.
- `POST /api/admin/blocked-dates` — block dates.
  Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:119`. Status: Missing.
- `DELETE /api/admin/blocked-dates` — unblock dates.
  Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:137`. Status: Missing.

// shape TBD during implementation

---

## /api/admin/email — email service health and test harness

Used by `EmailServicePage.tsx` (Settings → Email Service).

- `GET /api/admin/email/status` — current SMTP/IMAP status.
  Frontend: `frontend/src/pages/admin/EmailServicePage.tsx:36`. Status: Missing.
- `POST /api/admin/email/test` — end-to-end SMTP→IMAP loopback test.
  Frontend: `frontend/src/pages/admin/EmailServicePage.tsx:44`. Status: Missing.

// shape TBD during implementation

---

## /api/users/me/email/verify — change-email verification

Used by `EmailVerificationModal.tsx` (Profile page → change email flow).

- `POST /api/users/me/email/verify` — confirm a verification code.
  Frontend: `frontend/src/components/profile/EmailVerificationModal.tsx:28`. Status: Missing.
- `POST /api/users/me/email/verify/resend` — resend the verification email.
  Frontend: `frontend/src/components/profile/EmailVerificationModal.tsx:42`. Status: Missing.

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
