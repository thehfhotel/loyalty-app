# The guest rights path — runbook

Task F3 of the direct-booking program. This is the operational half of
[`2026-09-pdpa-data-map.md`](2026-09-pdpa-data-map.md): the map says what data
we hold and why, this says **who answers a guest who asks about it, how, and
by when**.

Written 2026-09-12 against the F3 branch. Sections marked **OWNER** are
decisions nobody has made yet; the app ships working without them, but the
notice is not finished until they are filled in.

> **Not legal advice.** PDPA (B.E. 2562) section numbers are shorthand: s.19
> consent, s.23 notice duty, s.24(3) contract, s.24(5) legitimate interest,
> s.30 access, s.31 refusal, s.32 objection, s.33 erasure, s.35
> rectification, s.37(4) breach notification.

---

## 1. Who answers

| | |
|---|---|
| **Published contact** | The address in the repository variable **`PDPA_CONTACT_EMAIL`**, printed on `/privacy` and (task C1) in the LINE OA footer and rich menu |
| **Who reads it** | **OWNER** — the mailbox must be read by a named person, not a shared alias nobody owns. F1 §10 Q2: "a rights request needs one address that is read" |
| **Fallback when blank** | `/privacy` shows the desk phone numbers (`VITE_DESK_PHONE_HF` / `VITE_DESK_PHONE_HFVILLE`) and "ติดต่อแผนกต้อนรับ". This is a worse answer, never a dead end |
| **Escalation** | **OWNER** — who decides a refusal, and who signs a breach notification to the PDPC |
| **DPO** | **OWNER + LAWYER** — F1 §10 Q3: does a hotel of this size need one under s.41? |

### Setting the contact address

It is a **build-time** variable, exactly like the desk phones added in #414 —
Vite inlines `import.meta.env.VITE_*` when the bundle is built, so editing a
running container changes nothing.

1. Settings → Secrets and variables → Actions → **Variables** → set
   `PDPA_CONTACT_EMAIL`.
2. Push any commit to `main` (or re-run **CI Build & Deploy**) so the frontend
   image is rebuilt. `ci-build-e2e.yml` passes it as the
   `VITE_PDPA_CONTACT_EMAIL` build arg.
3. Verify live: load `https://<host>/privacy` and confirm the contact card
   shows the address rather than the desk fallback.

---

## 2. The 30-day clock

PDPA s.30/s.31/s.32 give a controller **30 days** by default. The app measures
it for you:

- `privacy_requests.requested_at` is the start. It is set by the database, not
  by the client.
- `dueAt` (= `requested_at + 30 days`) and `overdue` are computed per row and
  returned on both the member's list and the admin queue. `overdue` is derived,
  never stored — a stored flag would need a job to keep it true.
- The admin queue at **`/admin/privacy-requests`** is ordered **oldest first**,
  because the oldest request is the closest to its deadline.

**Check the queue at least weekly.** Nothing pages you today; an overdue
counter you do not look at is the same as no counter. Adding an alert when
`overdueCount > 0` is a sensible follow-up and is deliberately not in F3.

### Where a request can arrive

| Channel | What to do |
|---|---|
| **In the app** (member, `/profile` → "ข้อมูลของฉัน") | Nothing — the row is already filed and the clock running |
| **Email** to the published contact | Identify the member, then file it for them via the admin queue **OWNER: no admin-side "file on behalf" route exists yet** — today, ask the member to use the app, or handle it manually and record the outcome in the mailbox thread |
| **LINE** (a guest replies to an OA message) | Same as email. F1 §8 gap 7 asked for "an answer for a request that arrives by LINE rather than email": that answer is *reply with the `/privacy` link and the contact address*, then handle by email, because the OA is report-only and not a ticketing system |
| **At the desk** | Take the booking reference and a callback number, then hand to whoever reads the contact mailbox |

---

## 3. Access (s.30) — the export procedure

1. Open `/admin/privacy-requests`, find the `access` request.
2. Press **Download export**. The browser saves
   `pdpa-export-<request-id>.json`. The download writes a
   `user_audit_log` row (`privacy_access_export`) naming the admin and the
   request — an export nobody can attribute is one we should not have
   produced.
3. **Verify the requester before you send it.** The app authenticates the
   member who *filed* the request; it does not verify the person who receives
   the file. For an in-app request the member is already authenticated, so
   sending it to the email on the account is sufficient. For anything else see
   §6.
4. Reply with the file attached, then resolve the request with a note saying
   how and where you sent it.

### What is in the export

`profile`, `loyalty`, `bookings`, `stays`, `pointsTransactions`, `coupons`,
`surveyResponses`, `paymentSlips` (metadata), `lineFriendships`,
`privacyRequests`.

### What is NOT in it, and what to say when asked

| Withheld | Why |
|---|---|
| **Slip images** (`booking_slips.slip_url` and the file) | The single most important exclusion. A slip is a photograph of a bank transfer and **the payer is frequently not the guest** (F1 §1) — it shows a third party's account name and number. An s.30 request is a right to *one's own* data, and releasing the image would disclose someone else's. The payload states this itself in `slipImages.included = false` with the reason attached |
| `slipok_response` (the vendor's raw JSON) | Nothing writes it today, and it would carry the payer's name if it did |
| `bookings.admin_notes`, `points_transactions.admin_reason` | Internal staff commentary. Reviewable and releasable, but a human reads it first — release it manually if the member asks specifically |
| `user_coupons.qr_code` | A redemption credential, not descriptive data |

The export lists its own exclusions in a `withheld` array, so the member can
see that something was held back rather than discovering it later.

**If a payer (not the guest) asks about their slip.** They are a data subject
too, and we never collected their contact details. Answer at the published
contact: confirm what a slip holds, that it is used only to check the payment,
that it is deleted on the retention schedule, and offer erasure of the image.
There is no self-service path for them and there will not be one — they have
no account.

---

## 4. Erasure (s.33) — what goes, and what survives retention

Resolving an `erasure` request as **done** calls
`services::account_deletion::erase_account` with `DeletionActor::Admin` — the
same code path as the member's own `DELETE /api/users/account`. It runs
*before* the row is marked done, so the log never claims an erasure that
failed.

### Deleted immediately

- `users.email`, `password_hash`, `oauth_provider`, `oauth_provider_id`
- `user_profiles`: first name, last name, phone, date of birth, avatar,
  preferences
- **All `line_friendships` rows** for that LINE userId — deleted, not flagged,
  because the row is keyed on the identifier we were asked to erase
- All `refresh_tokens` (every session ends)
- The in-app `notifications` inbox
- `user_audit_log.ip_address` and `user_agent` are nulled (the rows stay, so
  the log remains attributable by user id and nothing else)

The `users` row survives with `deleted_at` set and the pseudonymous
`membership_id`. Push targeting and login both read views (`push_targets`,
`login_identities`) that exclude it, so no message can reach them and no login
can resurrect them.

### Expires later, by retention — say this to the guest

| Data | When it actually goes |
|---|---|
| Slip image files | `SLIP_RETENTION_DAYS` after booking closure (proposed 90 days). **Off unless the variable is set** |
| Slip metadata, bookings, payment evidence | Kept as accounting records (proposed 5 years) |
| `points_transactions`, `stays`, `user_loyalty` | Kept — they are the money and the audit trail |
| `booking_audit_log` | `AUDIT_LOG_RETENTION_DAYS`, **floored at 365 days** |
| `slip_access_log` | `SLIP_ACCESS_LOG_RETENTION_DAYS`, **floored at 90 days** |
| Encrypted backups | An erase in the live database does not reach them. The deletion is complete when the last backup holding it expires — **OWNER: state the backup retention window** so "deleted" has a defined meaning |

Those floors are not configuration mistakes, they are the point: they exist so
we can always answer "who looked at this guest's payer's bank details", which
is what F1 §8 gap 2 asked for. They cannot be set lower.

### The trade-off to say out loud before pressing the button

Erasure destroys the link between the member and their points, tier and
nights. A later login with the same LINE or Google account creates a **new**
membership; the old balance cannot be reclaimed, because the only link back to
it was the provider id the erase destroyed. Both the member's confirm dialog
and the admin's warning line say so.

### Refusing an erasure

Legitimate, and s.31 expects a written reason. Typical: an accounting duty
over a recent booking, or a requester we could not verify. Put the reason in
the resolution note — it is required on `refused`, and it is what a regulator
would read.

---

## 5. Rectification (s.35) and objection (s.32)

- **Rectification** — the member's note says what is wrong. Fix it through the
  admin user screens, then resolve with a note saying what changed.
- **Objection** — in practice "stop messaging me". The immediate, guest-owned
  control is blocking the LINE OA, which stops messages instantly and is
  already documented in the notice. On our side, resolve the request and
  confirm; an erasure is the stronger remedy if they want the record gone too.

---

## 6. Non-members — the seam this release does not close

**Every deposit-link booking is owned by a fixed, non-loginable system actor**
(`DEPOSIT_LINK_SYSTEM_USER_ID`), because `bookings.user_id` is NOT NULL and a
phone-booking guest has no account (F1 §2). Their name, full phone and their
payer's slip therefore hang off a booking that **no `user_id` will ever
find**.

`privacy_requests.user_id` is NOT NULL, so the app's rights path does not
serve them. This is stated in the schema comment and in the code rather than
papered over.

**Today's procedure** — manual, at the published contact:

1. Take the **booking reference** (`pms_ref`) and the **phone number the
   booking was taken on**.
2. Verify them against the booking. **OWNER + LAWYER: what proof of identity
   do we accept here?** A phone number that matches is weak — anyone who knows
   it could ask. F1 §10 Q4 puts this exact question to the lawyer, and it is
   the single largest open item in this runbook. Until it is answered, treat a
   non-member erasure request as requiring a call-back to the number on the
   booking before acting.
3. Do the work through the admin booking screens and record the outcome in the
   mailbox thread. There is no `privacy_requests` row to show for it, so the
   thread **is** the record — keep it.

A future release should give this branch a real row keyed on
`guest_phone` + booking reference once the identity question is settled.

---

## 7. Breach notification — the 72-hour clock

**PDPA s.37(4): notify the PDPC without delay and, where feasible, within 72
hours of becoming aware of the breach. Where the breach is likely to result in
a high risk to the rights and freedoms of the persons affected, notify them as
well.**

A slip-storage breach is not a nuisance: it exposes **third-party bank
details** belonging to people who never had any relationship with us. Treat
any unauthorised access to `STORAGE_PATH/slips` or to the database as high
risk by default and argue your way down, not up.

### Step by step

**T+0 — Become aware.** The clock starts when anyone at the hotel has
reasonable grounds to believe personal data was breached. Not when it is
proven. Write down the time and who knew.

**T+0 to T+2h — Contain.**
1. If the app is implicated, roll back per
   [`rollback-runbook.md`](../rollback-runbook.md).
2. Rotate anything exposed per [`secrets-runbook.md`](../secrets-runbook.md).
3. Do **not** delete logs. `booking_audit_log`, `slip_access_log` and
   `user_audit_log` are how you will answer "what was taken", and the
   retention floors (365 / 90 days) exist so they are still there.

**T+2h to T+12h — Scope it.** Answer, in writing:
- What categories of data? (Slip images ⇒ third-party bank details ⇒ high
  risk.)
- How many people, and are any of them payers rather than guests?
- Is it contained, or ongoing?
- What are the affected people exposed to?

**T+12h to T+48h — Decide and draft.**
- **OWNER: who signs the PDPC notification?** Name the person here.
- Draft the notification: nature of the breach, categories and approximate
  number of data subjects and records, likely consequences, measures taken or
  proposed, and a contact point (the `PDPA_CONTACT_EMAIL` address).
- Decide whether individual notice is required (high risk ⇒ yes).

**Before T+72h — Notify the PDPC.** Late is not the same as not at all: if you
pass 72 hours, notify anyway and state the reason for the delay, which s.37(4)
contemplates.

**Then — Notify the affected people** where the risk is high, in plain Thai
and English: what happened, what data, what they can do (watch their bank
statements if slip data was involved), and how to reach us.

**After — Write it up.** Keep the record of the breach, its effects and the
remedial action regardless of whether it was notifiable. That record *is* the
accountability evidence.

### Known blind spots to check first in any incident

- **Cloudflare terminates TLS for everything**, including slip image bytes
  (F1 §7). A Cloudflare account compromise is in scope.
- **Backups are single-site** on evergreen, `age`-encrypted (F1 §7, and
  `public-launch-readiness.md`). Loss of that host is availability, not
  confidentiality — unless the age key leaked too.
- **Slip images are not backed up at all**, so a live-store breach has no
  second copy to chase.
- **Gmail holds every booking notification**, which makes the property mailbox
  the longest-lived copy of guests' phone numbers we hold (F1 §3).

---

## 8. The OA footer text (task C1)

The owner pastes this into the LINE OA footer / rich menu. `<URL>` is the
public app host — `https://<host>/privacy`.

**Thai**

```
ประกาศความเป็นส่วนตัวและสิทธิของท่านตาม PDPA: <URL>/privacy
สอบถาม ขอสำเนา หรือขอลบข้อมูล: <PDPA_CONTACT_EMAIL>
```

**English**

```
Privacy notice and your PDPA rights: <URL>/privacy
Questions, a copy of your data, or deletion: <PDPA_CONTACT_EMAIL>
```

**Both, for a single-line footer**

```
ความเป็นส่วนตัว / Privacy: <URL>/privacy
```

Set `PDPA_CONTACT_EMAIL` (§1) **before** publishing this, or the linked page
will show the desk fallback where the footer promises an address.

---

## 9. Open owner decisions

Everything below blocks "the notice is finished", not "the code works".

1. **`PDPA_CONTACT_EMAIL`** — the address, and the named person who reads it.
2. **The retention numbers.** 90 days / 5 years / 24 months / 12 months are
   *proposals* (F1 §10 Q1) and are published on `/privacy` marked as such.
   Confirm them, then remove the "(proposed)" labels from the `privacy.retention*`
   locale keys.
3. **`SLIP_RETENTION_DAYS` is unset**, so no slip image has ever been deleted.
   The notice says 90 days. Set the variable, or the sentence is not yet true.
4. **Non-member identity proof** (§6) — the largest open item.
5. **Who signs a PDPC notification** (§7).
6. **Backup retention window** (§4) — so "deleted" has a defined end date.
7. **Transfers abroad** (F1 §10 Q5) — LINE (Japan), Google (US), Cloudflare
   (US). The notice does not currently name them; whether it must is a lawyer
   question.
8. **zh-CN legal copy.** F1 §9 proposed *suppressing* the new slip card in
   Chinese rather than letting it fall back to English. F3 instead ships real
   Chinese translations, so no English fallback occurs — but the Chinese text
   has had no legal review. Either confirm it or replace it under task C12.
9. **An overdue alert** (§2). Nothing pages anyone today.

---

## 10. Where the code is

| | |
|---|---|
| Schema | `backend-rust/migrations/20260915030000_privacy_requests.sql` |
| Routes | `backend-rust/src/routes/privacy.rs` |
| Erasure | `backend-rust/src/services/account_deletion.rs` (called, never duplicated) |
| Retention floors | `backend-rust/src/config/mod.rs`, `services/audit_retention.rs`, `services/slip_retention.rs` |
| Public notice | `frontend/src/pages/PrivacyPage.tsx` |
| Member section | `frontend/src/components/profile/MyDataSection.tsx` |
| Admin queue | `frontend/src/pages/admin/PrivacyRequestsPage.tsx` |
| Contact variable | `frontend/src/utils/pdpaContact.ts`, `frontend/Dockerfile`, `.github/workflows/ci-build-e2e.yml` |
| Tests | `backend-rust/tests/integration/privacy_requests_test.rs`, `frontend/src/pages/__tests__/PrivacyPage.test.tsx`, `frontend/src/components/profile/__tests__/MyDataSection.test.tsx` |
