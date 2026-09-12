# SlipOK: degrading to manual, and the shadow-window agreement report

Two halves of the same rollout question — *is the automatic slip check
working, and is it good enough to trust?*

- **A4** (below, first half) — when the automatic check stops working, the
  desk is told **once**, and told **once** again when it comes back.
- **A9** (second half) — `GET /api/admin/slips/agreement-report`, the
  arithmetic that answers "may we turn `SLIPOK_AUTO_VERIFY` on?".

---

## Part 1 — Degrading to manual (A4)

### What already happened before this

`services::slip_match::decide` has always done the safe thing when the
vendor gives no verdict: the slip lands on `slipok_status = 'unavailable'`
with a reason (`quota_exceeded`, `api_error`, `timeout`, `not_configured`)
and waits for a human. **No slip is ever lost, and no guest is ever blamed
for our outage.** What was missing was anybody being *told*: a quota that
ran out at 09:00 looks, from the desk, exactly like a quiet morning.

### The alert channel

**Reused, not invented: the property mailboxes already wired for the
booking notification** — `BOOKING_NOTIFY_EMAIL_HF` and
`BOOKING_NOTIFY_EMAIL_HFVILLE`, through the same `EmailService` trait as
`services::booking_notify`. It is the only alerting surface this backend has
that reaches a person, it is already configured, and it is already where
reception looks.

Unlike a booking notification, an outage is not about one booking, so the
alert goes to **every** configured mailbox (deduplicated): one vendor
account serves both properties. No mailbox configured, or no SMTP relay, and
the episode is still tracked but nothing is sent — the same "unconfigured is
a normal state" rule the booking email follows.

The messages are **Thai first** with an English line underneath, and — like
every other message this backend sends — they never name the vendor.

| Event | Subject |
|---|---|
| Degraded | `ระบบตรวจสลิปอัตโนมัติหยุดทำงาน — สลิปรอพนักงานตรวจ` |
| Recovered | `ระบบตรวจสลิปอัตโนมัติกลับมาทำงานแล้ว` |
| 80 % of quota | `โควตาตรวจสลิปอัตโนมัติใช้ไปแล้ว NN%` |

### When it fires

`services::slipok_health` folds every SlipOK call outcome into a single
stored episode (`slipok_health`, one row). The tracker is attached to the
SlipOK *client* in `AppState::new`, so every upload path — the booking one
and the deposit-link one — is observed without either route handler knowing.

- **Answered** (verified *or* "this slip is bad") means the vendor is up and
  clears the failure run. A run of blurry photographs never reads as an
  outage.
- **`api_error` / `timeout`** need `SLIPOK_DEGRADE_FAILURE_THRESHOLD`
  consecutive misses (default **3**). A single 5xx costs one slip a trip
  through the manual queue, which is where every slip goes in shadow mode
  anyway.
- **`quota_exceeded`** degrades on the **first** refusal. Quota does not fix
  itself on retry.
- Once degraded, **nothing further is sent** until the vendor answers again.
  One outage is one alert, however long it lasts.
- The first answer after an announced outage sends **one** recovery notice.
- `SLIPOK_DEGRADE_ALERT_COOLDOWN_MINS` (default **60**) stops a flapping
  vendor turning one bad hour into forty emails: a degradation inside the
  cooldown is recorded but not announced, and a recovery is only sent for an
  episode that *was* announced.

### The monthly quota warning

The plan's real allowance is **unknown until the owner records it** (task
A3), so `SLIPOK_MONTHLY_QUOTA` is blank by default and the warning simply
never fires — an invented ceiling would either cry wolf or stay quiet past
the real limit.

When it is set, `slipok_monthly_usage` counts **our own** calls (the vendor
exposes no counter we can read) and one warning is sent as the 80 % line is
crossed, **once per calendar month**. Months are **Asia/Bangkok**, not UTC:
the quota is a Thai vendor's calendar month, and a UTC boundary would file
the first seven hours of every month under the previous one.

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `SLIPOK_MONTHLY_QUOTA` | *(blank — unknown)* | Monthly check allowance. Blank ⇒ no quota warning ever. |
| `SLIPOK_DEGRADE_FAILURE_THRESHOLD` | `3` | Consecutive no-verdict calls before degrading (quota ignores it). |
| `SLIPOK_DEGRADE_ALERT_COOLDOWN_MINS` | `60` | Minimum gap between degradation alerts. |

All three follow the repo's blank-means-unset convention, so the
`${VAR:-}` a compose file passes reads as "not set".

### Metrics

`slipok_health_alerts_total{kind,outcome}` — `kind` is `degraded` |
`recovered` | `quota_warning`; `outcome` is `sent` | `failed` |
`skipped_no_recipient` | `skipped_unconfigured`.

### What the desk badge says

An `unavailable` slip is a plain status for reception, not an error report.
The admin sidebar badge reads **`ตรวจอัตโนมัติไม่พร้อม รอพนักงานตรวจ`**
(EN: *Auto-check not available — staff will verify*). The guest-facing badge
(`payment.slipok.status.unavailable`) deliberately collapses every
non-verified state into `กำลังตรวจสอบ` — the guest does not need to know
which of our systems is having a bad day.

---

## Part 2 — The agreement report (A9)

```
GET /api/admin/slips/agreement-report?from=YYYY-MM-DD&to=YYYY-MM-DD&property=hf
```

Admin only. All three parameters optional: the window defaults to the last
**14 days** (Asia/Bangkok days), and omitting `property` reports both.
`property` must be `hf` or `hfville` — anything else is a `400`, because an
empty report reads exactly like "no disagreements".

### How to read it

**What counts as a row.** A slip counts when the machine reached a verdict
inside the window (`slipok_checked_at`), a human has since reached a final
decision (`admin_status` is `verified` or `needs_action`), and **that
decision was made by a person** — slips auto-confirmed by the SlipOK system
actor are excluded. Counting those would be the machine marking its own
homework, and would drive the agreement rate towards 100 % exactly as the
flag got riskier.

**What agreement means.** The machine's verdict is read as a prediction of
what a person would do:

| machine `slipok_status` | prediction |
|---|---|
| `verified`, `shadow_pass` | a person verifies |
| `manual` | a person rejects |
| `unavailable` | **no prediction** — counted, never judged |

`agreementRate = agreements / decidableRows`, and `decidableRows` excludes
`unavailable`. A bad week at the vendor must not look like a bad matcher.

**The two disagreements are not equal.**

- `machineVerifiedHumanRejected` — the machine would have **confirmed a
  booking a person refused**. This is the one that moves money. Threshold:
  **zero**, not a rate.
- `humanVerifiedMachineManual` — the machine sent to manual something a
  person approved. Costs reception a look, which is what shadow mode does
  anyway. Threshold: **≤ 20 %** of `humanVerifiedRows` (the denominator is
  on the response so nobody has to guess which one was used).

**The recommendation.** `verdict` is exactly `flip` or `keep shadow`.
`flip` needs **all** of: `rowsConsidered ≥ 20`,
`machineVerifiedHumanRejected == 0`, and
`humanVerifiedMachineManual / humanVerifiedRows ≤ 0.20`. Otherwise
`failedThresholds` names which of `rows`,
`machine_verified_human_rejected`, `false_manual_rate` did not hold and
`reason` says it in a sentence.

Read `overall` for the decision — `SLIPOK_AUTO_VERIFY` is one global
variable — and the per-property sections to spot a single bad property
hiding inside a good average.

**No PII.** Slip ids, verdicts, timestamps, and the deciding admin's opaque
user id. No names, no emails, no guest details, no bank references, no slip
image URLs.

### Response shape

```jsonc
{
  "from": "2026-08-29",
  "to": "2026-09-11",
  "property": null,                 // echo of the filter; null = both
  "generatedAt": "2026-09-12T05:00:00Z",
  "overall": {                      // every row in the window, combined
    "property": "all",
    "rowsConsidered": 42,
    "machineVerdicts": {
      "verified": 0, "shadowPass": 28, "manual": 12,
      "unavailable": 2, "other": 0
    },
    "humanDecisions": { "verified": 30, "needsAction": 12 },
    "decidableRows": 40,            // rowsConsidered minus `unavailable`
    "agreements": 37,
    "disagreementCount": 3,
    "agreementRate": 0.925,         // agreements / decidableRows; null if 0
    "machineVerifiedHumanRejected": 0,
    "humanVerifiedRows": 30,        // the denominator below
    "humanVerifiedMachineManual": 3,
    "humanVerifiedMachineManualRate": 0.1,
    "reasonHistogram": [            // commonest first
      { "reason": "amount_mismatch", "count": 7 },
      { "reason": "quota_exceeded",  "count": 2 }
    ],
    "disagreements": [              // capped at 200; the counts stay exact
      {
        "slipId": "6f1c…",
        "machineStatus": "manual",
        "machineReason": "receiver_mismatch",
        "machineCheckedAt": "2026-09-03T04:11:20Z",
        "humanDecision": "verified",
        "decidedBy": "0b9a…",       // admin user id, no name or address
        "decidedAt": "2026-09-03T06:02:00Z",
        "kind": "human_verified_machine_manual"
      }
    ],
    "disagreementsTruncated": false,
    "recommendation": {
      "verdict": "flip",            // or "keep shadow"
      "reason": "42 decided slips, no slip the machine would have confirmed was rejected by a person, …",
      "failedThresholds": []        // "rows" | "machine_verified_human_rejected" | "false_manual_rate"
    }
  },
  "properties": [ /* the same section shape, one per property, `property` = "hf" | "hfville" | "unknown" */ ]
}
```

There is deliberately **no admin page** for this. It is a one-off
calibration artefact that exists to answer a single flag question and then
stop being interesting; a nav entry and a screen would outlive the decision.
Read it with the admin session already in the browser:

```bash
curl -sS --cookie "$ADMIN_COOKIE" \
  'https://<host>/api/admin/slips/agreement-report?from=2026-08-29&to=2026-09-11' | jq .overall
```
