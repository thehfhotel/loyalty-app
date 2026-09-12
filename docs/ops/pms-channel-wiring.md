# Switching on the loyalty → PMS booking channel

**Status: the channel is DARK, on both sides, and this document is how it gets
switched on.** Nothing here has been done. No repository variable or secret has
been set, and running through it is an owner decision, not a deploy step.

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

Source of truth for the new-hotel half: `new-hotel/docs/loyalty-channel.md`.

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

### 3. The base URL

```bash
gh variable set PMS_BASE_URL --repo thehfhotel/loyalty-app \
  --body 'http://host.docker.internal:3003'
```

A **variable**, not a secret, on purpose: it is not a credential, it is the one
value worth reading back in the UI to see where the channel points, and blanking
it is the rollback.

### 4. Deploy loyalty-app

```bash
gh workflow run deploy.yml --repo thehfhotel/loyalty-app --ref main
gh run watch --repo thehfhotel/loyalty-app
```

### 5. Switch the PMS side on

The loyalty app is now *able* to call the PMS, but the PMS still answers `503
channel_disabled` to everyone. Flipping `LOYALTY_CHANNEL_ENABLED=true` on
new-hotel is the **last** step and the only one guests can see — do it with
reception aware, per `new-hotel/docs/loyalty-channel.md`, and note that
new-hotel's own deploy does not yet pass these variables through either (its
go-live checklist covers that side).

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
| `503` + `{"reason":"channel_disabled"}` | **Correct**, before step 5. The request reached the PMS channel router and the PMS's own flag turned it away. |
| `401` | The route works and the flag is already on, but the token is wrong — token A does not match on the two sides. |
| `404` + HTML | The request landed on the Next.js app, not the channel router. The proxy rewrite is gone. |
| connection refused / timeout | No route. Check `extra_hosts` survived the deploy: `docker inspect loyalty_backend_production --format '{{.HostConfig.ExtraHosts}}'`. |

Note the `503` is returned **before** the token is checked (new-hotel's
`check_channel_access` gates on the flag first), which is what makes this a safe
check to run with no credentials at all.

### c. End to end, after step 5

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

* Passing `LOYALTY_CHANNEL_TOKEN` / `LOYALTY_CHANNEL_ENABLED` into the new-hotel
  container. That repo's deploy does not plumb them yet either; its
  `docs/loyalty-channel.md` owns that half.
* Issuing a Cloudflare Access service token, which would only be needed if the
  channel ever had to run over the public hostname.
