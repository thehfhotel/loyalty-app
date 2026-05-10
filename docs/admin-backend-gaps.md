# Admin backend gaps

These frontend admin pages and modals need Rust backend endpoints that don't
exist yet. Each entry lists the frontend `file:line` referencing the missing
endpoint and the proposed Rust route signature.

The frontend currently leaves a stub `useQuery`/`useMutation` that returns
empty data or throws "feature is being migrated" so existing components don't
crash. The pages are still reachable from the admin nav, so any user landing
on them sees an empty table or a disabled action.

When implementing these, please:

- Mount admin routes under `/api/admin/...` in `backend-rust/src/routes/admin.rs`
  (or a dedicated submodule if the surface grows).
- All routes must be guarded by `require_admin(&user)?` (same pattern as the
  existing user/stats/analytics handlers).
- Follow the request/response field naming used by the frontend types listed
  below — they were carried over from the legacy tRPC router and are the
  contract the React components already consume.

## Status legend

- **Missing** — no Rust handler exists, frontend renders stub
- **Partial** — a related public/booking endpoint exists but is not
  admin-scoped (e.g., `/api/bookings/availability` exists but there is no
  admin booking listing or admin slip verification surface)

---

## /api/admin/bookings — admin booking management

Used by the booking management table, slip viewer, and edit modal.

### `GET /api/admin/bookings` (list with filters and counts)

- Frontend: `frontend/src/pages/admin/BookingManagement.tsx:125`
- Status: Missing
- Query params:
  - `page: u32` (1-based)
  - `limit: u32` (default 10)
  - `search: Option<String>` (matches user name/email/membership id)
  - `status: Option<"confirmed" | "cancelled" | "completed">`
  - `sortBy: "created_at" | "check_in_date" | "room_type" | "status" | "total_price" | "user_name"`
  - `sortOrder: "asc" | "desc"`
- Response:
  ```json
  {
    "bookings": [/* AdminBookingResponse */],
    "total": 0,
    "statusCounts": { "all": 0, "confirmed": 0, "cancelled": 0, "completed": 0 }
  }
  ```
- Notes: `AdminBookingResponse` must include the nested `user`, `roomType`,
  `slips[]` (multi-slip), `auditHistory[]`, plus payment/discount fields. See
  the `Booking` interface at the top of `BookingManagement.tsx` for the full
  contract.

### `POST /api/admin/bookings/:id/verify-slip` (legacy single slip)

- Frontend: `frontend/src/pages/admin/BookingManagement.tsx:161`
- Status: Missing
- Body: `{}` (no payload)
- Response: `{ "success": true }`
- Notes: Legacy single-slip path used by the table action button. Logs an
  `admin_verified` audit entry.

### `POST /api/admin/bookings/:id/needs-action`

- Frontend: `frontend/src/pages/admin/BookingManagement.tsx:182`
- Status: Missing
- Body: `{ "notes": String }`
- Response: `{ "success": true }`
- Notes: Marks the booking's primary slip as `needs_action` with admin notes.
  Logs `needs_action_marked` audit entry.

### `POST /api/admin/bookings/slips/:slipId/verify` (multi-slip)

- Frontend: `frontend/src/components/admin/SlipViewerSidebar.tsx:131`
- Status: Missing
- Body: `{}`
- Response: `{ "success": true }`
- Notes: Per-slip verification for bookings with multiple uploaded slips.
  Logs `slip_verified` audit entry.

### `POST /api/admin/bookings/slips/:slipId/needs-action` (multi-slip)

- Frontend: `frontend/src/components/admin/SlipViewerSidebar.tsx:145`
- Status: Missing
- Body: `{ "notes": String }`
- Response: `{ "success": true }`
- Notes: Per-slip "needs action" for multi-slip bookings. Logs
  `slip_needs_action` audit entry.

### `PUT /api/admin/bookings/:id`

- Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:128`
- Status: Missing
- Body:
  ```json
  {
    "checkInDate": "DATE",
    "checkOutDate": "DATE",
    "numGuests": 2,
    "roomTypeId": "UUID",
    "notes": "string?",
    "totalPrice": 0
  }
  ```
- Response: updated `AdminBookingResponse`
- Notes: Logs `booking_updated` audit entry with old/new diff.

### `POST /api/admin/bookings/:id/discount`

- Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:144`
- Status: Missing
- Body: `{ "discountAmount": Decimal, "reason": String }`
- Response: updated `AdminBookingResponse`
- Notes: Logs `discount_applied` audit entry. Recalculates `paymentAmount`.

### `POST /api/admin/bookings/:id/cancel`

- Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:160`
- Status: Partial — public `POST /api/bookings/:id/cancel` exists in
  `backend-rust/src/routes/bookings.rs` but enforces user ownership. The
  admin variant must allow cancellation of any booking and stamp
  `cancelled_by_admin = true`.
- Body: `{ "reason": String }`
- Response: `{ "success": true }`
- Notes: Logs `booking_cancelled` audit entry. Should NOT refund nights/points
  automatically — that is a separate operations call.

### `GET /api/admin/bookings/room-types` (dropdown source for edit modal)

- Frontend: `frontend/src/pages/admin/BookingEditModal.tsx:119`
- Status: Missing
- Query params: none (returns active room types only)
- Response: `[{ "id": "UUID", "name": "string" }]`
- Notes: Could just reuse the public room-types listing once that exists
  (see below). Lightweight; UI only needs id+name.

---

## /api/admin/room-types — room-type CRUD

Used by `RoomTypeManagement.tsx`. The backend currently models `RoomType` as a
HARD-CODED enum (`Standard | Deluxe | Suite | Executive | Presidential` in
`backend-rust/src/services/booking.rs`). The frontend assumes a dynamic
`room_types` table with arbitrary names, prices, amenities, images, and sort
order. Implementing this requires:

1. A `room_types` table (or surfacing the existing one — confirm via migrations).
2. Migrating the `bookings` table to reference `room_type_id` UUID rather than
   the enum, OR keeping a compatibility shim.
3. The CRUD endpoints below.

### `GET /api/admin/room-types`

- Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:82`,
  `frontend/src/pages/admin/RoomAvailability.tsx:68`,
  `frontend/src/pages/admin/RoomManagement.tsx:61`
- Status: Missing
- Query params: `includeInactive: bool` (default false)
- Response: `RoomTypeResponse[]` (full schema below)
- Schema:
  ```json
  {
    "id": "UUID",
    "name": "string",
    "description": "string | null",
    "pricePerNight": 0,
    "maxGuests": 2,
    "bedType": "single | double | twin | king | null",
    "amenities": ["string"],
    "images": ["url"],
    "isActive": true,
    "sortOrder": 0,
    "createdAt": "ISO",
    "updatedAt": "ISO"
  }
  ```

### `POST /api/admin/room-types`

- Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:90`
- Status: Missing
- Body: same as schema above (no `id`, `createdAt`, `updatedAt`)
- Response: created `RoomTypeResponse`

### `PUT /api/admin/room-types/:id`

- Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:106`
- Status: Missing
- Body: same as schema above (partial update OK)
- Response: updated `RoomTypeResponse`

### `DELETE /api/admin/room-types/:id`

- Frontend: `frontend/src/pages/admin/RoomTypeManagement.tsx:123`
- Status: Missing
- Response: `{ "success": true }`
- Notes: Soft-delete (`isActive = false`) if any rooms or bookings reference
  this room type. Hard-delete only if completely unused.

---

## /api/admin/rooms — physical room CRUD

Used by `RoomManagement.tsx`. Requires a `rooms` table (room_number, floor,
room_type_id, notes, is_active).

### `GET /api/admin/rooms`

- Frontend: `frontend/src/pages/admin/RoomManagement.tsx:70`,
  `frontend/src/pages/admin/RoomAvailability.tsx:80`
- Status: Missing
- Query params:
  - `roomTypeId: Option<UUID>`
  - `includeInactive: bool` (default false)
- Response: `RoomResponse[]`
- Schema:
  ```json
  {
    "id": "UUID",
    "roomTypeId": "UUID",
    "roomNumber": "string",
    "floor": 0,
    "notes": "string | null",
    "isActive": true,
    "createdAt": "ISO",
    "updatedAt": "ISO",
    "roomType": { "id": "UUID", "name": "string" }
  }
  ```

### `POST /api/admin/rooms`

- Frontend: `frontend/src/pages/admin/RoomManagement.tsx:78`
- Status: Missing
- Body: `{ roomTypeId, roomNumber, floor?, notes?, isActive }`

### `PUT /api/admin/rooms/:id`

- Frontend: `frontend/src/pages/admin/RoomManagement.tsx:94`
- Status: Missing
- Body: same as POST

### `DELETE /api/admin/rooms/:id`

- Frontend: `frontend/src/pages/admin/RoomManagement.tsx:111`
- Status: Missing
- Notes: Soft-delete if the room has any historical bookings.

---

## /api/admin/blocked-dates — calendar availability blocks

Used by `RoomAvailability.tsx` to block specific room/date combinations
(maintenance, owner stays, etc.). The booking module already reads from
`room_blocked_dates` (see `bookings.rs:788`), but no admin-write endpoints
exist.

### `GET /api/admin/blocked-dates`

- Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:102`
- Status: Missing
- Query params:
  - `roomTypeId: Option<UUID>`
  - `from: DATE`
  - `to: DATE`
- Response: `RoomBlockedDates[]`
- Schema:
  ```json
  {
    "roomId": "UUID",
    "roomNumber": "string",
    "dates": [
      {
        "id": "UUID",
        "roomId": "UUID",
        "blockedDate": "ISO date",
        "reason": "string | null",
        "createdAt": "ISO",
        "createdBy": "UUID | null"
      }
    ]
  }
  ```

### `GET /api/admin/bookings/calendar` (room-level booking grid)

- Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:111`
- Status: Missing
- Query params:
  - `roomTypeId: Option<UUID>`
  - `from: DATE`
  - `to: DATE`
- Response:
  ```json
  [
    {
      "id": "UUID",
      "roomId": "UUID",
      "checkInDate": "ISO",
      "checkOutDate": "ISO",
      "status": "confirmed | cancelled | completed"
    }
  ]
  ```
- Notes: Lightweight projection of bookings, only the fields needed to color
  the calendar grid.

### `POST /api/admin/blocked-dates`

- Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:119`
- Status: Missing
- Body: `{ "roomId": "UUID", "dates": ["DATE", ...], "reason": String }`
- Response: `{ "blocked": <count> }`
- Notes: Reject if any of the dates overlap an existing confirmed booking for
  that room.

### `DELETE /api/admin/blocked-dates`

- Frontend: `frontend/src/pages/admin/RoomAvailability.tsx:137`
- Status: Missing
- Body: `{ "roomId": "UUID", "dates": ["DATE", ...] }`
- Response: `{ "unblocked": <count> }`

---

## /api/admin/email — email service health and test harness

Used by `EmailServicePage.tsx` (Settings -> Email Service in the admin nav).

### `GET /api/admin/email/status`

- Frontend: `frontend/src/pages/admin/EmailServicePage.tsx:36`
- Status: Missing
- Response:
  ```json
  {
    "configured": true,
    "smtpConnected": true,
    "imapConnected": true,
    "lastTestResult": {
      "success": true,
      "timestamp": "ISO",
      "deliveryTimeMs": 1234,
      "error": "string?"
    }
  }
  ```
- Notes: `lastTestResult` should be persisted (e.g., in a settings/audit table)
  so the page is informative even if the backend just restarted.

### `POST /api/admin/email/test`

- Frontend: `frontend/src/pages/admin/EmailServicePage.tsx:44`
- Status: Missing
- Body: `{}` (or optional `{ "to": String }` to override the loopback target)
- Response:
  ```json
  {
    "success": true,
    "testId": "string",
    "smtpSent": true,
    "imapReceived": true,
    "deliveryTimeMs": 1234,
    "error": "string?"
  }
  ```
- Notes: End-to-end loopback — send via SMTP, poll IMAP for the test message,
  return the round-trip time. Persist the result so `GET /status.lastTestResult`
  reflects it.

---

## /api/users/me/email/verify — change-email verification

Used by `EmailVerificationModal.tsx` (Profile page -> change email flow).

### `POST /api/users/me/email/verify`

- Frontend: `frontend/src/components/profile/EmailVerificationModal.tsx:28`
- Status: Missing
- Body: `{ "code": String }` (format `XXXX-XXXX`, A-Z + 0-9)
- Response: `{ "success": true, "email": String }`
- Notes: Accepts the code emailed to the new address, swaps the user's primary
  email if valid, marks `email_verified = true`. Should rate-limit to ~5
  attempts per code.

### `POST /api/users/me/email/verify/resend`

- Frontend: `frontend/src/components/profile/EmailVerificationModal.tsx:42`
- Status: Missing
- Body: `{}`
- Response: `{ "success": true }`
- Notes: Resends the verification email to the pending new address. Subject
  to a 60-second cooldown.

---

## Suggested rollout order

1. Room types CRUD + rooms CRUD (everything else depends on these).
2. Blocked dates + admin booking calendar.
3. Admin booking listing, edit, discount, cancel.
4. Multi-slip + legacy slip verification.
5. Email service status + test harness.
6. Email change verification (lower priority — profile flow currently works
   without it; the modal just isn't reachable).
