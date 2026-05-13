# Database Restore Runbook

This document covers how to restore a production Postgres backup created
by `.github/workflows/backup-production.yml`. The on-call operator should
be able to follow this end-to-end without prior context.

> See also: `docs/secrets-runbook.md`, `docs/rollback-runbook.md`.

## What gets backed up

Daily at 01:00 ICT (18:00 UTC) the `Backup Production Database` workflow:

1. Streams `pg_dump` of the production loyalty DB through the same
   cloudflared tunnel `deploy.yml` uses.
2. Pipes the dump through `gzip -9`.
3. Encrypts with `age` against `BACKUP_AGE_RECIPIENT` (a public key).
4. Uploads to `s3://${BACKUP_S3_BUCKET}/daily/loyalty_pg_<ts>.sql.gz.age`.

The dump uses `--no-owner --no-acl` so it can be restored into a DB
owned by any role (matches the way `deploy.yml` provisions Postgres).

## Required secrets and one-time setup

Until these are configured, the workflow runs only via
`workflow_dispatch` (the `if:` guard in `backup-production.yml` is the
on/off switch) and the scheduled trigger is inert.

| Secret                          | What it is                                       |
| ------------------------------- | ------------------------------------------------ |
| `BACKUP_AGE_RECIPIENT`          | Single-line `age1...` public key                 |
| `BACKUP_S3_BUCKET`              | Bucket name                                      |
| `BACKUP_S3_ENDPOINT`            | S3-compatible endpoint URL (empty for AWS S3)    |
| `BACKUP_S3_REGION`              | Region (`auto` for R2, `us-east-005` for B2, …)  |
| `BACKUP_S3_ACCESS_KEY_ID`       | Access key                                       |
| `BACKUP_S3_SECRET_ACCESS_KEY`   | Secret key                                       |

The age private key for decryption stays on the operator's machine and
is **not** stored in GitHub. Keep it in a password manager.

### 30-day retention

Server-side lifecycle policy on the bucket — recommended over deleting
inside the workflow because the workflow's IAM credentials don't need
`DeleteObject`.

- **R2**: bucket settings → Lifecycle rules → expire after 30 days
  under `daily/`.
- **AWS S3**: bucket → Management → Lifecycle rule → `daily/` prefix →
  Expire current versions after 30 days.
- **Backblaze B2**: bucket → Lifecycle settings → `daily/` → hide after
  30 days.

## Restoring from backup

### 1. Pick the dump

```bash
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 ls "s3://$BACKUP_S3_BUCKET/daily/"
# loyalty_pg_20260513T180001Z.sql.gz.age
```

Download a specific dump:

```bash
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp \
  "s3://$BACKUP_S3_BUCKET/daily/loyalty_pg_20260513T180001Z.sql.gz.age" \
  /tmp/restore.sql.gz.age
```

### 2. Decrypt and decompress locally

```bash
age --decrypt --identity ~/.age/loyalty-backup.key \
  /tmp/restore.sql.gz.age > /tmp/restore.sql.gz
gunzip /tmp/restore.sql.gz
# /tmp/restore.sql is now plain SQL — handle as sensitive data.
```

### 3. Stop the backend (drains in-flight writes)

Graceful shutdown (PR adding this runbook) ensures in-flight requests
complete before the container exits.

```bash
ssh -o ProxyCommand="cloudflared --edge-ip-version 4 access ssh --hostname %h" \
  deploy@evergreen.thehfhotel.org \
  'docker stop loyalty_backend_production'
```

### 4. Restore the dump

Drop and recreate the DB inside the Postgres container, then `psql` the
dump in.

```bash
ssh -o ProxyCommand="cloudflared --edge-ip-version 4 access ssh --hostname %h" \
  deploy@evergreen.thehfhotel.org bash -s <<'REMOTE'
  set -euo pipefail
  docker exec -i loyalty_postgres_production psql -U "$POSTGRES_USER" -d postgres <<SQL
    DROP DATABASE IF EXISTS "${POSTGRES_DB}_restore";
    CREATE DATABASE "${POSTGRES_DB}_restore";
SQL
REMOTE

# Pipe the local SQL file into the remote postgres container
ssh -o ProxyCommand="cloudflared --edge-ip-version 4 access ssh --hostname %h" \
  deploy@evergreen.thehfhotel.org \
  "docker exec -i loyalty_postgres_production psql -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB}_restore\"" \
  < /tmp/restore.sql
```

### 5. Verify the restored data

```bash
ssh ... 'docker exec loyalty_postgres_production psql -U "$POSTGRES_USER" \
  -d "${POSTGRES_DB}_restore" -c "SELECT COUNT(*) FROM users;"'
```

Spot-check a few tables (`users`, `bookings`, `points_transactions`,
`booking_audit_log`) match the row counts you expect for the backup date.

### 6. Promote the restored DB

Only after verification. This is irreversible without another restore.

```sql
-- inside `docker exec -it loyalty_postgres_production psql -U "$POSTGRES_USER" -d postgres`
ALTER DATABASE "${POSTGRES_DB}"          RENAME TO "${POSTGRES_DB}_pre_restore";
ALTER DATABASE "${POSTGRES_DB}_restore"  RENAME TO "${POSTGRES_DB}";
```

### 7. Bring the backend back up

```bash
ssh ... 'docker start loyalty_backend_production'

# Wait for the embedded healthcheck binary to report healthy
curl -fsS https://loyalty.saichon.com/api/health
```

### 8. Clean up

After ~24 hours of healthy production, drop the safety copy:

```sql
DROP DATABASE "${POSTGRES_DB}_pre_restore";
```

## Combining restore with a code rollback

The current `sqlx::migrate!` design is forward-only — no
down-migrations. If you also need to roll back code past the last
applied migration, **restore the DB first**, then deploy the prior
image SHA. See `docs/rollback-runbook.md` for the code rollback path.

## Restore drill log

Document each restore drill here so the next operator can see when this
was last exercised.

| Date       | Operator | Backup restored                          | Notes                |
| ---------- | -------- | ---------------------------------------- | -------------------- |
| _pending_  | _name_   | _e.g. loyalty_pg_20260513T180001Z._      | First drill required |

> **Pre-launch action**: perform one full end-to-end restore drill into
> a throwaway database before flipping the public switch. Record the
> result in this table.

## Troubleshooting

### `age: failed to decrypt: no identity matched any of the recipients`

The `BACKUP_AGE_RECIPIENT` used at backup time doesn't match the
identity you passed to `age --decrypt`. Confirm the public key in the
GitHub secret matches the private key you have.

### `aws: command not found`

```bash
brew install awscli            # macOS
sudo apt-get install awscli    # Debian/Ubuntu
```

### `psql: error: connection to server ... password authentication failed`

`POSTGRES_USER` / `POSTGRES_PASSWORD` env vars on the remote shell
don't match what's currently in the running container's `.env`. SSH in
and `cat /srv/.../.env | grep POSTGRES`.

### Dump is empty / `0 bytes`

The backup workflow includes a `< 1024 bytes` sanity check. If a dump
gets that small in production, investigate before relying on it.
