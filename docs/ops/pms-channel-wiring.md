# Switching on the loyalty → PMS booking channel

**Status: the channel is DARK, on both sides, and this document is how it gets
switched on.** The deploy plumbing is complete in BOTH repos — new-hotel's
landed with board items B3 (#296) and B3c (#298), loyalty-app's with B4b — so
nothing below is a code change. What is missing is the values: no token has been
minted, no repository variable or secret has been set. Running through this is
an owner decision, not a deploy step.

What the channel is: the loyalty app is a first-party booking channel into the
PMS (ADR-0003). With it on, a guest booking on `loyalty.saichon.com` gets live
availability and a real room hold from the PMS instead of a "the front desk will
confirm" fallback, and a completed stay at checkout comes back the other way as
nights and points.

---

## The two directions, and the two tokens

They are **separate secrets**. One per direction, so rotating one never silently
opens the other. Getting these crossed is the single easiest mistake here, so
the table is the thing to read twice:

| Direction | Who calls | Token | Set it on **loyalty-app** as | Set it on **new-hotel** as |
|---|---|---|---|---|
| loyalty → PMS (availability, holds) | loyalty backend calls `POST/GET /api/channel/*` | **token A** | `PMS_CHANNEL_TOKEN` (secret) | `LOYALTY_CHANNEL_TOKEN` (secret) |
| PMS → loyalty (checkout stays) | PMS calls `POST /api/loyalty/stays` | **token B** | `LOYALTY_SERVICE_TOKEN` (secret) | `LOYALTY_SERVICE_TOKEN` (secret) |

Both are sent as `Authorization: Bearer <token>`. The sender holds it, the
receiver verifies it, and the two names for token A differ because each repo
names the variable after *the other side*.

**Both repos are already plumbed for all four keys** — this PR closed the last
gap, which was on the loyalty side. On new-hotel the wiring landed with board
items B3 (#296) and B3c (#298) and was verified live on 2026-09-10, so every
step below is a *value* change plus a redeploy, never a code change. The
new-hotel half rides a different mechanism from this repo's and it is worth
knowing which, because it changes what "unset" looks like:

| key | repo | kind | how it reaches the container |
|---|---|---|---|
| `PMS_BASE_URL` | loyalty-app | repo **variable** | deploy jq → `.env` → compose `environment:` |
| `PMS_CHANNEL_TOKEN` | loyalty-app | repo **secret** | deploy jq → `.env` → compose `environment:` |
| `LOYALTY_SERVICE_TOKEN` | loyalty-app | repo **secret** | deploy jq → `.env` → compose `environment:` |
| `LOYALTY_CHANNEL_TOKEN` | new-hotel | repo **secret** | payload `.secrets.loyalty_channel_token` → `/home/deploy/secrets/…` → `/run/secrets/…` (**file**, no `environment:` entry) |
| `LOYALTY_SERVICE_TOKEN` | new-hotel | repo **secret** | payload `.secrets.loyalty_service_token` → same file path |
| `LOYALTY_APP_URL` | new-hotel | repo **variable** | workflow → `.env` → compose `${LOYALTY_APP_URL:-}` |
| `LOYALTY_CHANNEL_ENABLED` | new-hotel | **compose-owned flag** | committed `docker-compose.yml` default only — *not* a repo variable |

On the new-hotel side an unset GitHub secret produces an **empty file**, not a
missing one, and the hydrator reads an empty file as absent — which is why
mounting those secrets opened nothing. `env` wins over the file if both are
present, which is a local-dev affordance only.

Source of truth for the new-hotel half: `new-hotel/docs/loyalty-channel.md` →
"Provisioning (deploy plumbing)".

---

## The value for `PMS_BASE_URL`

```
http://host.docker.internal:3003
```

An **origin with no path**. The client joins `api/channel/availability` and
friends onto it, producing
`http://host.docker.internal:3003/api/channel/availability`, which is exactly
where the PMS mounts its channel router.

### Why that value, and why plain `http` is safe here

Investigated read-only on evergreen, 2026-09-12:

* The PMS backend container (`new-hotel-production-backend-1`) **publishes no
  host port at all** — `docker port` returns nothing. Port 3003 is internal to
  its container.
* It sits on a **different bridge network** (`new-hotel-production_hotel-network`,
  172.19/16) from the loyalty backend (`loyalty-app-production_default`,
  172.30/16), so `http://new-hotel-production-backend-1:3003` does not resolve
  from inside the loyalty container.
* What *is* published on host `3003` is the PMS **web tier**
  (`new-hotel-production-web-1`, `0.0.0.0:3003->3003`) — and that Next.js app
  proxies straight through to the Rust backend. `new-hotel/next.config.js`:

  ```js
  { source: '/api/:path*', destination: `${backendUrl}/api/:path*` }
  ```

  The path is preserved and `Authorization` passes through untouched.

* **Proven live** from the loyalty network's own gateway — which is what
  `host.docker.internal` resolves to for a container with the `host-gateway`
  entry:

  ```
  $ curl -s -o - -w '%{http_code}' http://172.30.0.1:3003/api/channel/availability
  503 {"error":"loyalty channel is disabled","reason":"channel_disabled","success":false}
  ```

  A `503 channel_disabled` is the *good* answer. It is the PMS's own channel
  middleware fail-closing on `LOYALTY_CHANNEL_ENABLED=false` — which means the
  request crossed the network, crossed the proxy, and reached the channel
  router. A `404` would have meant the proxy does not carry that path; a
  connection error would have meant no route at all.

Plain `http` is accepted by the loyalty backend's validator only for loopback,
`host.docker.internal`, and dotless container hostnames — shapes that cannot
leave the machine. This value is one of them, so the bearer token never touches
a network anyone else is on. `https://hotel.thehfhotel.org` is **not** usable:
Cloudflare Access 302-redirects every path on it, `/api/*` included, so a
machine-to-machine call gets a login page.

### What this PR had to add for it to work

`docker-compose.prod.yml` now gives the backend service:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Docker Desktop provides that name for free; the Linux box does not, and the
loyalty container did not have it. It is one line in `/etc/hosts` and changes
nothing until `PMS_BASE_URL` is set. (`hf-ads-guard` on the same box already
uses this entry — it is the established pattern here, not a new one.)

### The alternative, if the owner prefers it

Put both stacks on one docker network and use `http://new-hotel-production-backend-1:3003`,
skipping the Next.js hop. **Not recommended**, and the reason is availability,
not elegance: it would make the loyalty stack depend on a network whose name is
derived from the new-hotel compose project, so a rename or a teardown over there
would stop the loyalty backend from starting at all. The proxy hop is cheap; a
start-up dependency between two independently deployed stacks is not.

---

## The recipe

Run from a clone of each repo. `openssl rand -hex 32` mints a 256-bit token.

### 1. Token A — loyalty → PMS

```bash
TOKEN_A=$(openssl rand -hex 32)

gh secret set PMS_CHANNEL_TOKEN     --repo thehfhotel/loyalty-app --body "$TOKEN_A"
gh secret set LOYALTY_CHANNEL_TOKEN --repo thehfhotel/new-hotel   --body "$TOKEN_A"

unset TOKEN_A
```

**Same value, both places.** They are the two ends of one credential.

### 2. Token B — PMS → loyalty

```bash
TOKEN_B=$(openssl rand -hex 32)

gh secret set LOYALTY_SERVICE_TOKEN --repo thehfhotel/loyalty-app --body "$TOKEN_B"
gh secret set LOYALTY_SERVICE_TOKEN --repo thehfhotel/new-hotel   --body "$TOKEN_B"

unset TOKEN_B
```

A **different** value from token A. Same variable name on both sides this time.

Note the asymmetry: on **loyalty-app** this token arrives as an environment
variable, on **new-hotel** as a mounted secret file. Same string either way.

### 3. The loyalty app's URL, on new-hotel

Token B on its own does nothing. The PMS builds its stay-hook client only when
it has **both** the token and a base URL to send to — with either missing,
`LoyaltyClient::from_config` yields `None` and no stay ever accrues points (the
checkout itself is unaffected, which is why this can go wrong quietly):

```bash
gh variable set LOYALTY_APP_URL --repo thehfhotel/new-hotel \
  --body 'https://loyalty.saichon.com'
```

Check whether it is already set before writing it — `gh variable list --repo
thehfhotel/new-hotel`. An unset variable is a no-op (its workflow fallback and
its compose default are the same literal), so a blank here is safe, just inert.

### 4. The base URL

```bash
gh variable set PMS_BASE_URL --repo thehfhotel/loyalty-app \
  --body 'http://host.docker.internal:3003'
```

A **variable**, not a secret, on purpose: it is not a credential, it is the one
value worth reading back in the UI to see where the channel points, and blanking
it is the rollback.

### 5. Deploy both repos

Neither secret reaches a container until its repo deploys. loyalty-app:

```bash
gh workflow run deploy.yml --repo thehfhotel/loyalty-app --ref main
gh run watch --repo thehfhotel/loyalty-app
```

new-hotel deploys on a push to `master`, so its go-live is whatever the next
push is — or run its ship skill (`/ship`) to trigger one deliberately. Until
that deploy runs, `/home/deploy/secrets/loyalty_channel_token` is still the
empty file it has been since #296, and the PMS will answer `401` to a loyalty
app that now holds a token.

Order does not matter, because the channel is still closed at the PMS end by the
flag. Both directions stay dark until step 6.

### 6. Flip the flag — a separate, later decision (B10/B11)

Everything above is provisioning; this is the go-live, and it is the only step
guests can see. The loyalty app can now reach the PMS and authenticate, but the
PMS still answers `503 channel_disabled` to everyone, including a perfectly
valid token.

`LOYALTY_CHANNEL_ENABLED` is **not** a repository variable and `gh variable set`
will not move it. It is compose-owned under new-hotel's ADR 0004, because it
guards a legacy write — a channel hold lands in the shared legacy DB as a normal
`จอง` the moment it is created (coexistence invariant #6). Its state is the
committed default in new-hotel's `docker-compose.yml`:

```yaml
- LOYALTY_CHANNEL_ENABLED=${LOYALTY_CHANNEL_ENABLED:-false}
```

so the flip is a one-line reviewable diff that `git log -S
LOYALTY_CHANNEL_ENABLED` can date, and new-hotel's `lint-deploy-flag-ownership`
CI job fails the build if anyone tries to route it through a repo variable
instead. Do it with reception aware, per `new-hotel/docs/loyalty-channel.md`.

This is tracked separately on the program board (**B10 / B11**) and is out of
scope for the wiring above — provisioning the tokens does not commit anyone to
flipping it.

---

## Verifying

### a. The loyalty backend knows about the PMS

```bash
ssh evergreen 'docker logs loyalty_backend_production 2>&1 | grep "PMS "'
```

Want:

```
  PMS Channel: Configured — base host host.docker.internal:3003, token set
  PMS stay accrual: Enabled (LOYALTY_SERVICE_TOKEN set)
```

Before the switch-on it reads `PMS Channel: Not configured (...) — availability
and holds go to the desk`. The line names the **host only** — never the path,
never any part of the token.

A `PMS Channel: HALF configured` warning means one of the two got set and the
other did not. Fix that before going further: it looks configured and sends
every booking to the desk anyway.

### b. The route actually carries

```bash
ssh evergreen 'curl -s -o - -w "\n%{http_code}\n" \
  http://172.30.0.1:3003/api/channel/availability'
```

| You get | It means |
|---|---|
| `503` + `{"reason":"channel_disabled"}` | **Correct**, before step 6. The request reached the PMS channel router and the PMS's own flag turned it away. |
| `401` | The route works and the flag is already on, but the token is wrong — token A does not match on the two sides. |
| `404` + HTML | The request landed on the Next.js app, not the channel router. The proxy rewrite is gone. |
| connection refused / timeout | No route. Check `extra_hosts` survived the deploy: `docker inspect loyalty_backend_production --format '{{.HostConfig.ExtraHosts}}'`. |

Note the `503` is returned **before** the token is checked (new-hotel's
`check_channel_access` gates on the flag first), which is what makes this a safe
check to run with no credentials at all.

### c. End to end, after step 6

Book a test stay through `loyalty.saichon.com` and confirm the hold appears in
the PMS. Coordinate with reception first — this creates a real hold on a real
room.

---

## Rollback

Blank the variable and redeploy. That is the whole rollback:

```bash
gh variable set PMS_BASE_URL --repo thehfhotel/loyalty-app --body ''
gh workflow run deploy.yml --repo thehfhotel/loyalty-app --ref main
```

A blank reads as **unset**, not as an empty URL, so the channel goes dark and
bookings fall back to the front desk. It does not bring the backend down — which
is precisely why the config reads these through `env_present`: taken literally,
an empty `PMS_BASE_URL` fails the boot-time validator and the backend would
refuse to start.

To roll back harder, flip `LOYALTY_CHANNEL_ENABLED=false` on new-hotel — that
closes the channel at the PMS end for every caller, with no loyalty deploy.

Leaving the tokens in place while the base URL is blank is fine and is the
cheapest way to re-arm: set the variable again, redeploy.

---

## What this document does not cover

* The go-live decision itself (step 6 / board items **B10 / B11**) and the
  reception coordination around it. The plumbing is complete on both sides; what
  remains is a judgement call, not a wiring gap.
* Issuing a Cloudflare Access service token, which would only be needed if the
  channel ever had to run over the public hostname.
