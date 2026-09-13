# Giving the weekly measurement pack a sanctioned way to read production

**Status: the plumbing is complete, the secret is NOT set, and the feature is
off until it is.** Nothing below is a code change — every step is a value plus a
redeploy. Until somebody runs it, `REPORT_READ_TOKEN` is unset, the middleware
is inert, and the weekly pack has no API path to production numbers.

## What this replaces, and why it matters

The weekly measurement pack is assembled by an agent with no admin account and
no way to get one — admin access is an identity that belongs to a person, and
minting one for a report would be a far larger grant than the report needs. So
the pack had been reading production the only other way available: a superuser
`psql` session, `SELECT`-only by convention.

That breaks this repo's own hard rule 5:

> **Never touch the database directly** — go through the backend API. If the
> endpoint doesn't exist yet, create it first. — `CLAUDE.md`

A rule the weekly report breaks every week is a rule nobody believes. And the
grant is wrong in both directions at once: a superuser session can read every
column of every table including every guest's personal data, while leaving no
record of having done so. The three numbers the pack actually wants are already
computed by three endpoints that exist.

So: one optional secret that opens those three endpoints, read-only, rate
limited, and audited on every use.

---

## What the token opens — and what it does not

| Route | What the pack takes from it |
|---|---|
| `GET /api/analytics/deposit-funnel` | funnel stages + the D15 friction proxies |
| `GET /api/admin/stats` | `totalUsers`, `lineFollowers` |
| `GET /api/admin/slips/agreement-report` | the SlipOK shadow-window agreement rate |

**That is the complete list.** Every other route under `/api/admin` answers
`401` to this token, including the ones that sit beside these three in the same
router — `/api/admin/users`, `/api/admin/analytics`,
`/api/admin/deposit-links`, `/api/analytics/dashboard` and the rest. It is not
an admin login, it does not mint one, and it cannot be escalated into one:

- a match inserts a **capability marker** into the request, not an `AuthUser` —
  there is no user id, no email, no role, and **no user row** anywhere;
- the marker can only be created by `middleware::report_token`, which is
  mounted with `route_layer` on those three routes and nowhere else;
- everything else is still behind `auth_middleware`, which sees a bearer that is
  not a JWT and refuses it.

`report_token_is_refused_on_every_other_admin_route` in
`backend-rust/tests/integration/report_token_test.rs` is the standing proof, and
it runs on every PR.

An admin JWT reads all three exactly as it always did; a signed-in customer is
still `403`; an anonymous caller is still `401`. Setting the secret widens
nothing that an admin could not already do.

---

## Owner recipe

### 1. Mint the token and set the secret

```bash
gh secret set REPORT_READ_TOKEN --repo thehfhotel/loyalty-app \
  --body "$(openssl rand -base64 36)"
```

A **secret**, not a repository variable — it is a bearer credential and nobody
needs to read it back. Rotating it means minting a new one and redeploying; the
old one stops working the moment the new container starts.

Keep the value where the pack's agent can reach it and nowhere else. It never
needs to be pasted into a chat, an issue, or a commit.

### 2. Redeploy

The secret reaches the container through `deploy.yml`'s jq payload →
`.env` → compose `environment:`. Nothing picks it up without a deploy:

```bash
gh workflow run "CI Build & Deploy" --repo thehfhotel/loyalty-app --ref main
```

…or simply merge anything to `main`, which is what normally fires it.

### 3. Read back that it took

```bash
ssh evergreen 'docker logs loyalty_backend_production 2>&1 | grep "Report read token"'
```

Two possible lines, and they are the whole verification:

```
  Report read token: configured — REPORT_READ_TOKEN opens GET /api/analytics/deposit-funnel, GET /api/admin/stats and GET /api/admin/slips/agreement-report, and nothing else
  Report read token: not configured (REPORT_READ_TOKEN unset) — the weekly pack has no API path to production numbers
```

The token itself is never logged, not one character. If the value is shorter
than 32 characters a `WARN` follows telling you to mint a longer one; it is a
warning and not a refusal, because a length check that stops the process would
take the whole backend down over an optional feature (the B4b lesson, #442).

### 4. The three calls

```bash
curl -sS -H "Authorization: Bearer $REPORT_READ_TOKEN" \
  'https://loyalty.saichon.com/api/analytics/deposit-funnel?granularity=week'

curl -sS -H "Authorization: Bearer $REPORT_READ_TOKEN" \
  'https://loyalty.saichon.com/api/admin/stats'

curl -sS -H "Authorization: Bearer $REPORT_READ_TOKEN" \
  'https://loyalty.saichon.com/api/admin/slips/agreement-report'
```

`Authorization: Bearer` is the only accepted form — no query parameter, no
custom header, no cookie. A query parameter would land the credential in every
access log and every browser history that ever saw the URL.

`loyalty.saichon.com/api/*` is reachable from a machine: the production deploy's
own verify step curls `/api/health` from a GitHub runner and requires a 200, so
there is no Cloudflare Access login page in front of the API. (That is the
opposite of `hotel.thehfhotel.org`, where Access 302s every path — see
[`pms-channel-wiring.md`](pms-channel-wiring.md).)

---

## Auditing what the machine read

Every accepted report-token request writes a row **before** the handler runs:

| column | value |
|---|---|
| `action` | `report_token_read` |
| `details->>'actor'` | `report_token` |
| `details->>'route'` | one of the three paths above |
| `user_id` | `NULL` — there is no user |
| `ip_address`, `user_agent` | the caller's |

Read it back through the API's own admin surface, or, for the owner with a
session on the box:

```sql
SELECT created_at, details->>'route' AS route, ip_address
FROM user_audit_log
WHERE action = 'report_token_read'
  AND details->>'actor' = 'report_token'
ORDER BY created_at DESC
LIMIT 50;
```

Three rows a week is the expected shape. Anything else — a different route, a
burst, an address that is not the pack's — is worth a look, and rotating the
secret is a one-line command plus a deploy.

The audit write is **fail-closed**: if the row cannot be written the request is
refused with a 503 and the handler never runs. This is the only place in the
codebase that does not treat an audit write as best-effort, and it is deliberate
— "every use is recorded" is the entire argument for handing a machine a
production credential, so a read nobody can account for would quietly falsify
the case for the feature existing.

`user_audit_log` and not `booking_audit_log`, because `booking_audit_log` is
`booking_id NOT NULL` referencing `bookings` and `admin_id NOT NULL` referencing
`users`. A report read is not about one booking, and the reader deliberately has
no user row — a row there could only be written by inventing both, i.e. a
migration and a fake user, in order to record a read. `user_audit_log.user_id`
is nullable and asks for neither, which is why this change needs no migration.

---

## The budget

Requests carrying a bearer on those three routes are charged a **60 per minute
per client address** bucket, and the charge happens **before** the token is
compared — so guessing the token costs the guesser their budget, which is the
only path worth bounding. Over budget is a `429` with a truthful `Retry-After`.

Fail-**open**: if Redis cannot be reached the request is allowed and a warning
is logged. A Redis blip must not take the weekly pack down — nor the one of
these three routes an admin actually opens in a browser, `/api/analytics/deposit-funnel`,
which the admin Analytics page reads and which therefore shares the bucket.
(`/api/admin/stats` and the agreement report have no frontend caller.) The
credential, not the budget, is what keeps this path closed. (Contrast the public
deposit-link routes, which fail *closed*, because those have no credential at
all.)

---

## Turning it off

Blank the secret and redeploy:

```bash
gh secret delete REPORT_READ_TOKEN --repo thehfhotel/loyalty-app
```

The deploy's jq program merges optional keys **non-empty-only**, so an unset
secret ships no key at all rather than an empty one, `config::env_present` reads
a blank as absent either way, and the middleware goes back to being a pure
pass-through: no header read, no Redis round trip, no audit row. The boot log
says `not configured`.

That belt-and-braces matters more here than for most settings on that list,
because this value is *compared against* a caller-supplied bearer: read
literally, an empty expected token would make `Authorization: Bearer ` (nothing
after it) authenticate as the report reader on three production endpoints.
Blank means absent, in the config layer and in the header parser both.

---

## Where the pieces live

| Piece | Where |
|---|---|
| Config (`REPORT_READ_TOKEN`, blank = off) | `backend-rust/src/config/mod.rs` → `ReportReadConfig` |
| Middleware, principal, `ReportAccess` extractor | `backend-rust/src/middleware/report_token.rs` |
| The three mounts | `routes/analytics.rs`, `routes/admin.rs`, `routes/admin_slip_report.rs` |
| Boot log line | `backend-rust/src/main.rs` |
| Tests | `backend-rust/tests/integration/report_token_test.rs` |
| Deploy plumbing | `.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.prod.yml` |
| Templates | `.env.example`, `.env.production.example` |
