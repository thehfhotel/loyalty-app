# PDPA data map — the direct-booking and deposit program (2026-09)

Task F1 of the 90-day direct-booking program
(`hf-tasks/tasks/direct-booking-designs/program-plan.md:263`). Scope: the personal
data this program *added* — slip images, deposit request links, booking notification
email, LINE friendships, survey responses, stay history and push targeting. Written
2026-09-10 against `origin/main` at `a092bcf2`. Every fact below is cited to a file;
where the code and an assumption disagreed, the code won.

**Not legal advice.** It is the factual base a lawyer and the owner sign off on, and
the input F2 (retention, deletion, admin-view access logging) and F3 (guest rights,
published notice) build from. Thailand's PDPA (B.E. 2562) section numbers are used
as shorthand: s.19 consent, s.23/s.25 notice duty, s.24(3) contract, s.24(5)
legitimate interest, s.28/s.29 transfer abroad, s.30-s.33 data-subject rights,
s.37(4) breach notification.

**Controller:** the hotel operating company, for both properties (`hf` = The Harbour
Front Hotel, `hfville` = HF Ville). The Program is one controller across both
properties — `CONTEXT.md` "Program" — so a rights request cannot be bounced between
them.

---

## 1. Slip images (photographs of bank transfers)

**The third-party problem, stated first.** A PromptPay slip is a photograph of a
completed transfer. It carries the *payer's* display name, a masked account or proxy
value and the sending bank — and the payer is frequently not the guest (a family
member, an employer, a friend). We have no contract with that payer and never
collected the data from them. This is the single fact that makes this row different
from every other row in this map.

| | |
|---|---|
| **Data elements** | The image file itself (JPEG/PNG, ≤10 MB) — free-form, whatever the guest's banking app renders: payer display name, payer masked account, payee name and masked account, amount, date/time, transaction reference, sometimes a memo. Plus the derived columns: `slipok_status`, `slipok_reason`, `slipok_trans_ref`, `slipok_checked_at`, `admin_status`, `admin_verified_at`, `admin_verified_by`, `admin_notes` |
| **Data subject** | Guest (booking holder) **and** payer (a third party in a material share of cases). Also staff — `admin_verified_by` identifies the admin who decided |
| **Lawful basis** | *Guest:* contract, s.24(3) — verifying the deposit is a step in performing the booking. *Payer:* legitimate interest, s.24(5) — confirming that money we were sent is the money a booking owes, and detecting a reused slip, cannot be done without reading who sent it; the payer chose to transfer to us and expects the transfer to be checked. Consent is the wrong basis here: refusing would mean refusing the payment |
| **Purpose** | Confirm one deposit against one booking. Nothing else — no marketing, no profiling, no cross-booking analysis |
| **Storage** | File: `STORAGE_PATH/slips/<uuid>.<ext>` (`routes/slips.rs:39,277`; `services/storage.rs:805-813`). In production that is the `backend_storage` Docker volume mounted at `/app/storage` (`docker-compose.prod.yml:129,171`). Metadata: `booking_slips` (`migrations/20260511000000_booking_slips.sql:31-46`, extended by `20260910000000_booking_slips_slipok.sql:44-47`) |
| **Access** | Image: `GET /storage/slips/:filename` — authenticated, then either any `admin` role **or** the member who owns the booking the slip hangs off (`routes/storage.rs:305-345`, owner chain at `374-389`). Metadata and decisions: `GET/POST /api/admin/bookings/slips/:slip_id{,/verify,/needs-action}`, `require_admin` on each (`routes/admin_slips.rs:209,289,422,473-478`). **Caveat:** the owner branch is `booking_slips → bookings.user_id` (`routes/storage.rs:374-389`), and on a deposit-link booking that column holds the fixed system actor, not a person (§2) — so for those slips the owner branch resolves to nobody who can log in, and only an admin can ever fetch the image. The guest who uploaded it cannot retrieve their own copy through this route |
| **Retention proposal** | **Image: 90 days after booking closure** (checkout, cancellation or expiry — whichever ends the booking), then the file is erased. **Metadata row: 5 years** from the same trigger — amount, `slipok_trans_ref` and the decision are payment evidence and the duplicate-detection key (`routes/bookings.rs:845-854`), and a chargeback or tax question arrives long after the picture is useless |
| **Deletion today** | **None.** No job, no route, no `remove_file` anywhere touches `STORAGE_PATH/slips` — a repo-wide grep for a purge/retention path finds nothing. `DELETE /api/users/account` is a soft delete only: `UPDATE users SET is_active = false` (`routes/users.rs:957-979`), as is the admin path (`routes/admin.rs:724+`). Slips therefore live forever, and a member who "deletes their account" still has their payer's bank photo on disk |
| **Deletion needed** | F2: an erase job keyed on booking closure that removes the file and blanks nothing else; a per-booking erase callable from the rights path (F3); and a rule that an erased image leaves the metadata row intact with a tombstone, so the audit trail does not develop a hole |
| **Processors** | **SlipOK** (Thai slip-verification vendor) receives **the whole image**, as multipart to `https://api.slipok.com/api/line/apikey/{branchId}` (`services/slipok.rs:39,647-678`). We send `log=false` so the vendor does not retain it (`slipok.rs:661-670`) — that is a request over an API, not a control we can verify, so the DPA (owner task A3) is what actually stands behind it. No other processor sees a slip |

**Two facts worth keeping:** the `slipok_response` JSONB column exists in the schema
(`20260511000000_booking_slips.sql:39`) but **nothing writes it** — `record_slipok_result`
persists only the four `slipok_*` scalars (`routes/bookings.rs:965-977`), so the vendor's
raw JSON, including the payer's name, is never stored. And the payer's name never reaches
a log: `sender_name` exists only inside `services/slipok.rs` and a test fixture in
`services/slip_match.rs:249,268`. Both are good outcomes that a refactor could silently
undo; the notice in §9 promises them.

---

## 2. Deposit request links

| | |
|---|---|
| **Data elements** | On the link row: `token_hash` (SHA-256 — the token itself is never stored), `issued_by`, `issued_at`, `expires_at`, `revoked_at`, `first_opened_at`, `last_opened_at`, `open_count`, `note` (`migrations/20260912010000_deposit_links.sql:88-103`). On the booking it points at: `guest_name`, `guest_phone`, dates, room type, amounts, `booking_source = 'deposit_link'`, `pms_ref` (`20260912010000:59-66`; `20260710000000_property_line_channel.sql` bookings columns) |
| **Data subject** | Guest (a non-member, typically — a phone or LINE booking). Staff: `issued_by` names the receptionist |
| **Whose row is it** | **Nobody's.** `bookings.user_id` is NOT NULL and a deposit-link guest has no account, so every deposit-link booking is inserted against one fixed, non-loginable actor — `DEPOSIT_LINK_SYSTEM_USER_ID` (`routes/deposit_links.rs:100-111`, written at `routes/admin_deposit_links.rs:349`, seeded by `migrations/20260912010000_deposit_links.sql:161-217` the same way §7's `SLIPOK_SYSTEM_USER_ID` is). The guest's name, full phone and their payer's slip image therefore hang off a booking with no link to any account, and no `user_id` will ever identify them |
| **Lawful basis** | Contract, s.24(3) — the guest asked to book and to be sent a way to pay. `last_opened_at` / `open_count` are legitimate interest, s.24(5): "did the guest ever open the link" is what tells the desk to phone rather than wait, and it is deliberately session-grained (a read counts only after 30 minutes) so it cannot become a behavioural trail (`20260912010000:117-122`) |
| **Purpose** | Take a deposit for a booking reception already accepted, and let the desk see whether the link was opened, expired or revoked |
| **Storage** | `booking_deposit_links` and `bookings`, Postgres |
| **Access** | Guest side: no login — `GET /api/deposit` and `POST /api/deposit/slip`, authorised by the `X-Deposit-Token` header alone (`routes/deposit_links.rs:9-16`). The token is the capability; the guest link is `/d#<token>`, a fragment, so it never reaches a server log (`deposit_links.rs:34-58`). The guest view returns the **given name only** — no phone, email, membership id or booking UUID (`deposit_links.rs:71-73,601,815,1006`). Staff side: `POST/GET /api/admin/deposit-links{,/:id/revoke,/:id/reissue}`, `require_admin` (`routes/admin_deposit_links.rs:8-17`) |
| **Retention proposal** | Link row **90 days after `expires_at` or `revoked_at`**, then deleted; `token_hash` may be zeroed as soon as the link is dead. Booking rows follow the booking retention (§6), not this one. Default lifetime is already short — 48 h, hard-capped at 7 days (`admin_deposit_links.rs:68-72`) |
| **Deletion today** | None. Revoke sets `revoked_at`; the row and its `token_hash` stay forever. `ON DELETE CASCADE` from `bookings` (`20260912010000:130-134`) means a booking erase would take links with it, but nothing ever erases a booking |
| **Deletion needed** | F2: a sweep that deletes dead link rows past the window. Low risk, low value on its own — it matters because these rows are the pointer from a stranger's payment page to a named guest |
| **Processors** | None for the link itself. The share message reception sends travels over **LINE** or SMS from reception's own phone — the link text is generated here (`admin_deposit_links.rs:919,971`) but we are not the sender, so the channel is outside this system's control and inside the desk SOP (B14) |

**The consequence for rights, stated here so F3 cannot miss it.** The deposit program's
whole point is to serve guests who are *not* members, and this map's rights and erasure
design (§6 "Deletion needed", §10 Q4) is keyed on the authenticated member or on
`users.oauth_provider_id`. Keyed that way it silently excludes the entire non-member
population the program creates: a phone-booking guest who asks under s.30 or s.33 would be
answered "we hold no data about you" while `bookings.guest_name`, `bookings.guest_phone`
and their `booking_slips` rows persist. **The rights path must be resolvable by
`guest_phone` plus a booking reference, not only by `user_id`** — gap 7. Identity proof for
that branch (the phone the booking was taken on, plus the reference) is an owner and lawyer
question, not a coding one.

---

## 3. Booking notification email to the hotel mailboxes

| | |
|---|---|
| **Data elements** | In the message: guest name, **full unmasked phone number**, property, dates, room type, amounts, booking/slip state. Explicitly never in it: the slip image or any link to it, the payer's bank, account number or account name, the guest's LINE user id, the guest's email, any raw vendor response, or any vendor name (`services/booking_notify.rs:21-32`). Logged row: `booking_notify_log(event_key, booking_id, recipient, sent_at)` — `recipient` is the mailbox address in clear (`migrations/20260912000000_booking_notify_log.sql`) |
| **Data subject** | Guest. The recipient mailbox is a property mailbox, not a person, but `issued_by`-style staff attribution does appear in the audit trail behind it |
| **Lawful basis** | Contract, s.24(3) — telling the desk a named guest is arriving is performing the booking. Not marketing, not consent |
| **Purpose** | Reception can expect the guest and can call them back. The phone is unmasked deliberately and the reason is written down: a masked phone cannot be dialled, and the property already holds the same number in the PMS (`booking_notify.rs:26-32`) |
| **Storage** | Postgres `booking_notify_log` for the claim; the message itself lives in Gmail, in the property mailbox — outside this system and outside its backups |
| **Access** | Whoever holds the property mailbox. Recipients are configured per property (`booking_notify.rs:344`, `recipient_for`); the current owner decision routes new bookings to `hfville.hotel@gmail.com` with the HF mailbox to be confirmed (`program-plan.md:8a`) |
| **Retention proposal** | `booking_notify_log` rows **12 months**. The mailbox itself needs an owner-side rule — a Gmail auto-delete label or a stated "these are kept N months" — because in practice that mailbox becomes the longest-lived copy of every guest's phone number we hold |
| **Deletion today** | None on either side |
| **Deletion needed** | F2: sweep `booking_notify_log`. Owner: a retention rule on the mailbox (F3 records it in the notice; it is not app work) |
| **Processors** | The **SMTP relay** — the same account that sends password resets and verification codes, via `lettre` with `SMTP_*` settings (`services/email.rs:201-241`, `booking_notify.rs:46-52`). It sees recipient, subject and body, i.e. the guest's name and phone. **Google (Gmail)** hosts both property mailboxes and therefore holds the same data at rest |

---

## 4. LINE friendships and follow events

| | |
|---|---|
| **Data elements** | `line_friendships(line_user_id, property, is_friend, followed_at, updated_at)` — the LINE user id is a per-OA pseudonymous identifier, and it is personal data (`migrations/20260710000000_property_line_channel.sql`) |
| **Data subject** | Guest / member, and any member of the public who follows an OA without ever booking |
| **Lawful basis** | Consent, s.19 — following the OA *is* the opt-in, and blocking it is the opt-out. That position is already published (`frontend/src/pages/PrivacyPage.tsx:6-11`, `privacy.messagesBody`) and this map keeps it. The record of an *unfollow* rests on legitimate interest, s.24(5): we keep `is_friend = false` precisely so we do not message someone who left |
| **Purpose** | Route messages to the right OA (property affinity), and stop sending when the friendship ends |
| **Storage** | Postgres `line_friendships` |
| **Access** | Written only by the signed webhook `POST /api/line/webhook/{property}` — HMAC-SHA256 over the raw body, no JWT (`routes/line_webhook.rs:1-7,86-114`). Read by push routing and by admin counts |
| **Retention proposal** | `is_friend = true`: for as long as the friendship lasts. `is_friend = false`: **12 months after `updated_at`**, then delete the row. A blocked user's id is not a durable business need past a year |
| **Deletion today** | None. An unfollow writes `is_friend = false` and keeps the row (`line_webhook.rs:100-114`) — so today the LINE user id of everyone who ever blocked us is retained indefinitely |
| **Deletion needed** | F2: an unfollow-age sweep. F3: a rights path that can erase a `line_user_id` on request even when it maps to no member |
| **Processors** | **LINE (LY Corporation)** is the channel and independently holds the friendship, the user id and every message we push. We send it the user id and the message body (`services/line.rs:171`) |

---

## 5. Survey responses

| | |
|---|---|
| **Data elements** | `survey_responses(user_id, survey_id, answers JSONB, is_completed, progress, started_at, completed_at)` — free-text answers, so the content is unbounded and may name staff or describe health, food or accessibility needs. `survey_invitations(user_id, survey_id, status, sent_at, viewed_at, expires_at)` (`migrations/20240101000000_init.sql:286-318`) |
| **Data subject** | Member. Indirectly, any person a free-text answer names |
| **Lawful basis** | Consent, s.19 — answering is voluntary and the survey often carries a coupon reward (`survey_coupon_assignments`, init.sql:267). The invitation itself is legitimate interest, s.24(5), bounded by the push budget |
| **Purpose** | Service quality, and the stay-linked feedback KPI (K11) |
| **Storage** | Postgres `survey_responses`, `survey_invitations`, `survey_reward_history` |
| **Access** | The live surface is **`GET /api/surveys/:id/responses`** — `has_role("admin")`, paginated, and it returns the free-text answers (`routes/surveys.rs:782-793`). `/:id/analytics` and `/:id/export` are **registered but not implemented**: both check the admin role and then return `not_implemented_response()` (`surveys.rs:909-920` and `927-938`; router at `surveys.rs:1061-1064`). So the spreadsheet-on-a-laptop path does not exist yet, and today's unlogged bulk read is `/responses` — that is what F2's access-logging story has to cover (gap 9) |
| **Retention proposal** | **24 months** from `COALESCE(completed_at, started_at, created_at)` — *not* from `completed_at` alone. `completed_at` is nullable and `is_completed` defaults to false (`init.sql:302-316`), so an abandoned half-finished response is a stored row with real free-text content and a NULL `completed_at`; keyed on that column alone the sweep would match it never and retain it forever while the notice says 24 months. Aggregate analytics may outlive the window once responses are unlinked from `user_id` |
| **Deletion today** | None. `DELETE /api/surveys/:id` removes a *survey*, not a person's responses |
| **Deletion needed** | F2: an age sweep plus an unlink (set `user_id` NULL) rather than a hard delete, so the quality signal survives the erase. F3: responses must be included in an access request |
| **Processors** | None. Responses never leave the system — but see §3: nothing stops an admin pasting an export into email, which is a policy control, not a technical one |

---

## 6. Stay history, membership and push targeting

| | |
|---|---|
| **Data elements** | `stays(pms_stay_id, user_id, property, check_in, check_out, nights, points_awarded)` (`20260710000000_property_line_channel.sql`); `bookings` including `guest_name`, `guest_phone`, `pms_booking_id`, `pms_ref`, amounts; `user_profiles(first_name, last_name, phone, date_of_birth, avatar_url, membership_id)` and `users(email, oauth_provider, oauth_provider_id)` (`init.sql:467-500`). Targeting reads the `push_targets` view (never `users` directly), the friendship rows, and the property of the most recent stay (`services/line.rs`, `push_to_member`) |
| **Data subject** | Member; guest (for a non-member booking); staff (`admin_verified_by`, `issued_by`, `booking_audit_log.admin_id`) |
| **Lawful basis** | Membership, stays, tiers and points: contract, s.24(3) — this is the Program. Push *targeting* (choosing which OA speaks and which member hears it): legitimate interest, s.24(5), riding on the consent in §4 — the friendship is the permission, the targeting is how we honour it and keeps us from messaging someone twice from two OAs |
| **Purpose** | Run the loyalty program (nights → tier → coupons) and send at most one well-aimed message inside the agreed push budget |
| **Storage** | Postgres. `POST /api/loyalty/stays` is the write path, authorised by a shared service token, not a user session (`routes/loyalty.rs:632,667,717`) |
| **Access** | Members see their own; admins via the `/api/loyalty/admin/*` subtree (`routes/loyalty.rs:613-627`) |
| **Retention proposal** | Membership and stay history: **for the life of the membership, plus 24 months after the last stay or login**, then anonymise (keep nights and property for statistics, drop name, phone, email, LINE id, date of birth). Bookings and their money columns: **5 years**, as accounting records |
| **Deletion today** | **Real erase on the member's own path, soft delete still on the admin's.** `DELETE /api/users/account` runs `services::account_deletion::erase_account` (migration `20260914020000_account_deletion.sql`): it nulls `email`, `password_hash`, `oauth_provider`, `oauth_provider_id` and the whole profile, sets `users.deleted_at`, **deletes** the `line_friendships` rows for that LINE userId, revokes the refresh tokens, purges the in-app `notifications`, strips `ip_address` / `user_agent` off the `user_audit_log` rows (keeping the rows), and writes one PII-free `user_deletions` audit row. `DELETE /api/admin/users/:id` (`routes/admin.rs`) is still only `is_active = false` — a reversible deactivation, deliberately not an erase; an admin-run erasure for a rights request is still to build (gap 7) |
| **Deletion needed** | (a), (b) and (c) are **shipped**. What remains: the **dormancy sweep** that runs an erase without a request (F2, 24 months past the last stay or login), and an **admin-initiated erase** for a rights request that arrives by email or LINE (gap 7). Note the trade-off the erase locks in: a later login with the same LINE/Google provider id creates a **new** account with a new user id, and the old points, tier and nights cannot be reclaimed — the only link back to them was the provider id the erase destroyed. The guest-facing copy in §9 must say so before the button is pressed |
| **Processors** | **LINE** for the push itself. The **PMS (new-hotel / iHOTEL)** is the upstream source of stays and the recipient of channel bookings — a separate controller in the same group, not a processor of this app |

---

## 7. Cross-cutting facts

- **Audit trail.** `booking_audit_log(booking_id, admin_id, action, before_data, after_data, reason, occurred_at)` with `admin_id UUID NOT NULL` (`migrations/20260512020000_booking_admin_fields.sql:85-95`). Automatic verifies are attributed to a fixed, non-loginable actor, `SLIPOK_SYSTEM_USER_ID` (`services/slip_confirm.rs:37-49`, seeded by `20260911000000_slipok_system_user.sql`), so machine and human decisions are countable apart. `before_data`/`after_data` are JSONB snapshots and can therefore contain personal data indefinitely — retention here is F10, still open (`docs/public-launch-readiness.md:130-133`).
- **Viewing a slip is not recorded anywhere.** `serve_slip` authorises and returns bytes; it writes no audit row (`routes/storage.rs:317-345`). This is the largest single gap in the map: today we cannot answer "who looked at this guest's payer's bank details".
- **`user_audit_log` holds `ip_address INET` and `user_agent`** (`init.sql:415-425`) — personal data with no retention rule.
- **Backups.** `scripts/evergreen/backup-loyalty-db.sh` dumps Postgres, gzips and `age`-encrypts to `/srv/backups/loyalty` on evergreen, single-site by an accepted-risk decision (`docs/public-launch-readiness.md:104-116`). Two consequences: an erase in the live database does **not** reach backups until they age out, and **slip image files are not backed up at all** — the `backend_storage` volume is not in that script. The second fact means the image erase in §1 has no second copy to chase, which makes it easier, not harder.
- **Cloudflare is in the path of every row.** The evergreen host has no direct public ingress: all production traffic reaches it through the Cloudflare global network and a `cloudflared` tunnel (`docs/cloudflare-tunnel-runbook.md:1-21`). Cloudflare's edge therefore terminates TLS for, and can see, the slip image bytes returned by `GET /storage/slips/:filename`, the guest's unmasked phone in admin responses, and the `X-Deposit-Token` header that `routes/deposit_links.rs:34-58` keeps out of our own logs. No per-row "Processors" cell names it because it sits under all of them; it belongs in the processor inventory and in whatever DPA list the owner keeps.
- **Transfer abroad (s.28/s.29) — the question this map cannot answer on its own.** Outside Thailand: **LINE (LY Corporation, Japan)** holds the friendship, the user id and every pushed message (§4, §6); **Google (Gmail, US)** holds every booking notification and therefore the longest-lived copy of guests' phone numbers (§3); **Cloudflare (US)** terminates TLS for everything above. Inside Thailand, on the face of it: **SlipOK** (a Thai vendor) and the **SMTP relay** if the relay account is domestic — which nobody has confirmed. PDPA s.28/s.29 needs a stated basis for each overseas one; §10 Q5 puts it to the lawyer.
- **Redis holds personal data too, bounded by TTL rather than by a sweep.** Rate limiting stores client IP addresses as `rate_limit:{prefix}:{ip}` (`middleware/rate_limit.rs:434,639`) — the same IPs the `user_audit_log` bullet above calls personal data. `routes/storage.rs:365,375` caches `slip_owner:{slip_url}` → owning user UUID for five minutes; `oauth_state:{provider}:{key}` (`routes/oauth.rs:292`) and `email_test_quota:{admin_id}:{date}` (`routes/admin_email.rs:190`) live there as well. Every key carries an EXPIRE, so this is inventory, not an F2 work item — but a "where is my data held" answer that omits Redis is wrong.
- **Logging discipline already in place**: the deposit token is never logged and never in a URL (`routes/deposit_links.rs:60-70`); notification logs carry `hash_email`, never the address (`booking_notify.rs:29-32`); the payer name is never logged (§1).

---

## 8. Prioritised gaps — what F2 and F3 implement

**P1 — before the first reactivation batch or survey invitation goes out**

1. **Slip image erase job** (F2). 90 days after booking closure; deletes the file under `STORAGE_PATH/slips`, leaves the `booking_slips` row with a tombstone. Nothing deletes a slip today.
2. **Admin slip-view access logging** (F2). Every `GET /storage/slips/:filename` that an admin serves writes a row naming the admin, the slip and the time. Without it §9's notice sentence "every view is logged" is false.
3. ~~**Real account deletion** (F3).~~ **SHIPPED.** `DELETE /api/users/account` now erases rather than deactivates — `services/account_deletion.rs`, migration `20260914020000_account_deletion.sql`. What is now true, and what is not:

   - **The identifiers are gone.** `users.email`, `password_hash`, `oauth_provider`, `oauth_provider_id` are nulled/blanked; `user_profiles` loses `first_name`, `last_name`, `phone`, `date_of_birth`, `avatar_url` and `preferences`. The row and its `id` survive, plus a `users.deleted_at` tombstone and the pseudonymous `membership_id`.
   - **No push can target them, by construction, not by filter.** Every path that turns a user id into somewhere a message can be delivered now reads the **`push_targets`** view instead of `users`; the view's own `WHERE` excludes `deleted_at IS NOT NULL` *and* `is_active = false`. The three readers are `services/line.rs::push_to_member` (LINE push, the only real push), `routes/admin.rs::broadcast_notification` (the in-app notification fan-out — it can no longer reach an erased member even with `activeOnly: false`) and `routes/auth.rs::forgot_password` (the reset email). A future dispatch that forgets the predicate is now a visible mistake in a `FROM` clause rather than an invisible missing `AND`.
   - **The friendship rows are deleted, not flagged.** `line_friendships` is keyed on the LINE userId, so marking `is_friend = false` would have kept holding the identifier we were asked to erase. A genuine later follow event re-creates the row for whatever account exists then.
   - **No resurrection.** The login paths read the **`login_identities`** view (`routes/oauth.rs` Google and LINE find-or-create plus the account-link probes, `routes/auth.rs` password login, refresh and the Cloudflare Access exchange), which hides erased rows. A LINE or Google login with the same provider id therefore provisions a **new** user id. **Trade-off:** the erased account's points, tier and nights cannot be reclaimed — that is the intended cost of destroying the link, and §9's copy has to say so.
   - **The money and the audit trail survive.** `bookings`, `booking_slips`, `points_transactions`, `stays`, `user_loyalty` and `booking_audit_log` are untouched and still list for admins under the old user id. `user_audit_log` rows are kept but depersonalised (`ip_address`, `user_agent` nulled), so the log stays attributable by user id and nothing else. Sessions (`refresh_tokens`) and the in-app `notifications` inbox are deleted.
   - **There is an audit row.** One `user_deletions` row per erasure: user id, who asked (`actor` = `self` / `admin`, `requested_by`), when, the **names** of the anonymised columns, the provider *name*, and counts of what was severed. No personal data, by construction — never the provider id, never an address.
   - **It is idempotent.** A repeat `DELETE` is a 200 no-op and writes no second audit row (a unique index on `user_deletions.user_id` plus a `SELECT … FOR UPDATE` makes that true under concurrency too). A user id with no row at all is still a 404.
   - **Still open:** the admin path `DELETE /api/admin/users/:id` remains a reversible `is_active = false` deactivation, not an erase — an admin-run erasure for a rights request belongs to gap 7. The F2 dormancy sweep that erases without a request is still to build. And an erase in the live database does not reach the backups until they age out (see §7 and gap 12).
4. **Published notice + named contact** (F3). The current `privacy.*` page has four cards and no mention of slip images, payers, retention periods or a named contact (`PrivacyPage.tsx:18-40`, `th/translation.json` `privacy.contactBody`). §9 is the copy; the retention numbers in it are only true once gap 1 ships.
5. **Payer notice route** (F3). PDPA s.25 asks that data collected from someone other than the data subject be notified to them. We will never have the payer's contact details, so the honest answer is a notice on the payment page itself, before the upload, plus a rights channel that accepts a request from a payer who is not the guest.

**P2 — inside the program window**

6. **Retention sweeps** (F2) for `booking_deposit_links` (90 days past death), `line_friendships` where `is_friend = false` (12 months — narrowed by gap 3: an erasure already deletes the erased member's rows outright, so this sweep now only covers people who unfollowed without deleting their account), `survey_responses` (24 months, unlink not delete), `booking_notify_log` (12 months), `user_audit_log` IP/user-agent (12 months — likewise narrowed: an erasure already strips both columns for that member).
7. **Rights request path** (F3): access, correction, erasure, objection to messaging — with a written turnaround (PDPA s.30-s.32 default 30 days), a log of requests, and an answer for a request that arrives by LINE rather than email. The erasure *mechanism* now exists (gap 3) and `services::account_deletion::DeletionActor::Admin` already records an admin-attributed erase; what is missing is the admin-facing route that invokes it and the request log around it. **It must have a non-member branch keyed on `guest_phone` + booking reference**, because every deposit-link booking is owned by a system actor and no `user_id` will ever find it (§2).
8. **Breach notification step** (F3): who decides, the 72-hour clock to the PDPC (s.37(4)), and the fact that a slip-storage breach exposes third-party bank details, which raises it above a nuisance.
9. **Survey responses are an unlogged bulk read** (F2). The surface is `GET /api/surveys/:id/responses` (`surveys.rs:782-793`), not `/export` — `/export` and `/analytics` are 501 stubs (§5). Same treatment as gap 2, or at least a counter. Build the logging into `/export` when it is implemented rather than retrofitting it afterwards.
10. **Owner: SlipOK DPA on file** (A3), and the mailbox retention rule for §3.

**P3 — after the flip**

11. **`booking_audit_log` partitioning and a written window** (F10, depends on this map): 5 years, partitioned by `occurred_at` year. **Shipped as a batched prune, not partitioning** — `services/audit_retention.rs` also covers `slip_access_log`, which this map gained in F2 and which grows far faster (one row per slip per admin booking-list page load). Partitioning was rejected on the query patterns: both tables are read by `booking_id` / `slip_id` and never by time, so no partition could ever be pruned by the planner and every read would fan out across all of them. The window itself is still the owner's to set (`AUDIT_LOG_RETENTION_DAYS`, `SLIP_ACCESS_LOG_RETENTION_DAYS`; blank = off), floored at 365 days and 90 days so it cannot be set below what §8 gap 2 and PDPA s.30–s.32 need.
12. **Backup expiry vs erasure**: state the backup retention window in the notice so "deleted" has a defined meaning (an erase is complete when the last backup holding it expires).
13. **Re-audit the single-site backup decision** now that the database holds payment evidence and photographs of bank transfers (F13).

---

## 9. Guest-facing notice sentences (Thai first)

Drafted from `hf-tasks/tasks/direct-booking-designs/f-policy-copy-drafts.md` §3, with the
blanks filled by the retention proposals above. **Not publishable until gaps 1 and 2 ship** —
until then the last two sentences describe controls that do not exist. `[ผู้ติดต่อ]` stays
blank for the owner (gap 4).

**Locales.** The app ships three — `th`, `en`, `zh-CN` — with `fallbackLng: 'en'`
(`frontend/src/i18n/config.ts:31`), and `zh-CN` already carries the full existing
`privacy.*` card set. The blocks below are Thai and English only, so **zh-CN is deferred to
C12** (`program-plan.md:209`, which requires zh-CN to cover exactly the booking, slip-upload
and status screens — including the deposit page the pre-upload line sits on). Until C12
lands, F3 must **suppress** the new slip card and the new `messagesBody` sentences in
`zh-CN` rather than let them fall back to English: a Chinese-reading guest getting an
English-only PDPA notice on the upload screen is worse than getting the existing card
unchanged. That is a deliberate call, not an oversight — and it means F1's verify-live
("the notice text matches the map, line for line") is checked in `th` and `en` only.

### ภาพสลิปโอนเงิน (การ์ดใหม่ ต่อจาก `privacy.*` เดิม)

> เมื่อท่านชำระเงินมัดจำ เราเก็บภาพสลิปโอนเงินที่ท่านอัปโหลด ภาพสลิปอาจแสดงชื่อบัญชีและเลขบัญชีธนาคารของผู้โอนเงิน
> ซึ่งอาจไม่ใช่ชื่อผู้จองห้องพัก (เช่น กรณีครอบครัวหรือเพื่อนโอนเงินแทนกัน)
>
> เราใช้ภาพสลิปเพื่อตรวจสอบและยืนยันการชำระเงินมัดจำเท่านั้น ไม่ใช้เพื่อการตลาดหรือวัตถุประสงค์อื่น
>
> เราส่งภาพสลิปให้ผู้ให้บริการตรวจสอบสลิปในประเทศไทยเพื่อตรวจสอบโดยอัตโนมัติ และแจ้งผู้ให้บริการไม่ให้เก็บภาพไว้
>
> เราเก็บภาพสลิปไว้ 90 วัน นับจากวันที่การจองสิ้นสุด (เช็คเอาต์หรือยกเลิก) จากนั้นจะลบภาพออกจากระบบ
> ส่วนข้อมูลการชำระเงิน เช่น จำนวนเงินและเลขอ้างอิงรายการ เราเก็บไว้ 5 ปี ตามหน้าที่ทางบัญชี
>
> เฉพาะพนักงานแผนกต้อนรับและผู้ดูแลระบบที่ได้รับอนุญาตเท่านั้นที่เข้าถึงภาพสลิปได้ ทุกครั้งที่มีการเปิดดูภาพสลิป ระบบจะบันทึกไว้เป็นหลักฐาน
>
> หากท่าน หรือผู้ที่โอนเงินแทนท่าน ต้องการสอบถาม ขอสำเนา หรือขอให้ลบข้อมูลนี้ ติดต่อ [ผู้ติดต่อ]

### English

> When you pay a deposit, we store the transfer slip image you upload. The slip may show
> the bank account name and number of whoever sent the money, which may not be the guest
> who made the booking (for example, a family member or friend transferring on their behalf).
>
> We use the slip image only to check and confirm the deposit payment. Never for marketing
> or any other purpose.
>
> We send the slip image to a Thai slip-verification provider for an automatic check, and
> we ask that provider not to keep it.
>
> We keep the slip image for 90 days after the booking ends (check-out or cancellation),
> then delete it. Payment details such as the amount and the transaction reference are kept
> for 5 years, as accounting records.
>
> Only front desk staff and authorised admins can view slip images. Every view is logged.
>
> If you, or the person who sent the payment on your behalf, want to ask about this, request
> a copy, or ask us to delete it, contact [contact].

### One line for the deposit page itself, above the upload button (PDPA s.25, payer-facing)

> **ก่อนอัปโหลด:** ภาพสลิปนี้ใช้ตรวจสอบการชำระเงินเท่านั้น เก็บไว้ 90 วัน แล้วลบ — [ประกาศความเป็นส่วนตัว]
>
> *Before you upload:* this slip is used only to check your payment, kept for 90 days, then
> deleted — [privacy notice].

### Two sentences to add to the existing `privacy.messagesBody` card (§4, §6)

> หากท่านบล็อกบัญชี LINE Official ของโรงแรม เราจะหยุดส่งข้อความทันที และจะลบบันทึกการเป็นเพื่อนออกจากระบบภายใน 12 เดือน
>
> If you block the hotel's LINE Official Account we stop messaging you immediately, and we
> delete the friendship record within 12 months.

---

## 10. Open questions for the owner and the lawyer

1. **Retention numbers** — 90 days / 5 years / 24 months / 12 months above are *proposals*.
   The owner sets them; the notice cannot be published with a blank.
2. **Named PDPA contact** — the current notice says "the hotel support email or the front
   desk" (`privacy.contactBody`). A rights request needs one address that is read.
3. **Lawyer** — is legitimate interest the right basis for the payer's data, or does the
   payment page need an explicit acknowledgement before upload? And does a hotel of this
   size need a Data Protection Officer under s.41?
4. **Where a guest's own copy comes from** — an access request today would be assembled by
   hand from six tables. F3 should decide whether that stays manual (documented) or gets a route.
   Whichever it is, it needs the non-member branch from §2: deposit-link guests are found by
   phone and booking reference, never by `user_id`. What proof of identity do we accept on
   that branch, given the requester has no account to log into?
5. **Transfer abroad, s.28/s.29** — LINE (LY Corporation, Japan) holds friendships and pushed
   messages, Google (US) holds every booking notification mailbox, and Cloudflare (US)
   terminates TLS for all traffic including slip images (§7). On what basis do those transfers
   stand — adequacy, standard contractual clauses, consent, or s.28's contract-performance
   exception — and does any of them need to be named in the published notice?
