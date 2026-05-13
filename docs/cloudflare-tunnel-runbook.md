# Cloudflare Tunnel Runbook

The evergreen host has no direct public-internet ingress. Both
production user traffic and the GitHub Actions deploy SSH path flow
through a `cloudflared` tunnel daemon on the host. This runbook covers
restart, health check, and Cloudflare-incident contingency.

> See also: `docs/rollback-runbook.md`, `docs/restore-runbook.md`.

## What the tunnel carries

```
                    ┌───────────────────────────────┐
                    │   Cloudflare global network   │
                    └─────────────┬─────────────────┘
       loyalty.saichon.com (prod) │
       loyalty-dev.saichon.com    │
       cloudflared access ssh ────┤
                                  ▼
                  ┌──────────────────────────────────┐
                  │  cloudflared daemon on evergreen │
                  │  (systemd unit, single process)  │
                  └─────────────┬────────────────────┘
                                ▼
                  ┌──────────────────────────────────┐
                  │  Local services on evergreen     │
                  │  - nginx :4001  (prod ingress)   │
                  │  - nginx :4101  (staging ingress)│
                  │  - sshd  :22    (deploy access)  │
                  └──────────────────────────────────┘
```

A single tunnel daemon serves all of:

- `https://loyalty.saichon.com` → production nginx → production backend
- `https://loyalty-dev.saichon.com` → staging nginx → staging backend
- `ssh` via `cloudflared access ssh` → deploy SSH user → host shell

When the daemon dies, **all three go dark simultaneously**.

## Tunnel identity

The Cloudflare account that owns this tunnel: **thehfhotel**.

| Field           | Value / How to find                                   |
| --------------- | ----------------------------------------------------- |
| Tunnel name     | `loyalty-app-evergreen` (verify via Cloudflare UI)    |
| Tunnel UUID     | `cat /etc/cloudflared/config.yml` on evergreen        |
| Systemd unit    | `cloudflared.service`                                 |
| Config file     | `/etc/cloudflared/config.yml`                         |
| Credentials     | `/etc/cloudflared/*.json` (tunnel-secret, 0600 root)  |
| Log destination | `journalctl -u cloudflared`                           |

If you don't have shell on evergreen, the tunnel is also visible in the
Cloudflare dashboard at **Zero Trust → Networks → Tunnels**.

## Restart procedure

```bash
# 1. SSH in (this itself goes through the tunnel — see "If the tunnel is
#    already down" below if SSH fails).
ssh -o ProxyCommand="cloudflared --edge-ip-version 4 access ssh --hostname %h" \
  deploy@evergreen.thehfhotel.org

# 2. Confirm the daemon's state.
sudo systemctl status cloudflared

# 3. Restart cleanly.
sudo systemctl restart cloudflared

# 4. Watch logs for a fresh "Registered tunnel connection" line.
sudo journalctl -u cloudflared -f
```

A healthy restart logs four lines of the form:

```
INF Registered tunnel connection connIndex=0 ...
INF Registered tunnel connection connIndex=1 ...
INF Registered tunnel connection connIndex=2 ...
INF Registered tunnel connection connIndex=3 ...
```

(One per Cloudflare edge data center.) Anything fewer than 2 connections
means a partial Cloudflare-side issue; anything zero means the daemon
is broken locally.

## Health verification

```bash
# From any internet-connected machine — no Cloudflare credentials needed:
curl -fsS https://loyalty.saichon.com/api/health
curl -fsS https://loyalty-dev.saichon.com/api/health

# From evergreen itself (validates the tunnel's outbound):
cloudflared tunnel info <tunnel-uuid>
```

`tunnel info` shows the per-connection state and the last heartbeat
timestamp.

## If the tunnel is already down (and SSH-through-tunnel won't work)

The deploy SSH path uses the same tunnel as user traffic — so the very
SSH connection you'd use to restart cloudflared depends on cloudflared
being alive. Recovery requires out-of-band access to evergreen:

- **Direct SSH** (if evergreen has a public IP or a separate management
  network): use that path to `sudo systemctl restart cloudflared`.
- **Cloud provider serial console** (if evergreen is hosted at a cloud
  provider that offers one): get a shell that way.
- **Physical access** (if evergreen is on-premise).

There is no second tunnel today — see "Single point of failure" below.

## During a Cloudflare incident

A regional Cloudflare outage (Cloudflare's `https://www.cloudflarestatus.com`
is the source of truth) blocks both user traffic and deploys.

There is no automatic fallback. The contingency is:

1. Post on the status / support email channel that the app is down due
   to an upstream Cloudflare incident.
2. Wait. Trying to "fix" the tunnel during an upstream Cloudflare
   incident usually just adds noise; the daemon side is fine.
3. When Cloudflare recovers, verify the tunnel re-registered
   automatically (`systemctl status cloudflared` on evergreen, or check
   the Cloudflare dashboard). If it stuck in a half-state, restart it.

## Cloudflare-side health notifications

Enable on the Cloudflare account: **Zero Trust → Networks → Tunnels →
<tunnel> → Configure → Notifications → Tunnel state alerts → email me
on `Inactive`**.

This is the cheapest available paging signal for the tunnel itself —
it fires within a few minutes of the daemon losing all of its
connections.

## Single point of failure

The tunnel is currently a SPOF. Mitigation options for after public
launch:

- Run a second cloudflared daemon on a second host with the same
  credentials; Cloudflare load-balances across both automatically.
- Add a Cloudflare Workers-side static fallback page for total outage.

Both are out of scope for the current ops bundle. Tracked in the
operational audit (HIGH-6 follow-up).
