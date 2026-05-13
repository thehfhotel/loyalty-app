# Migration Rewrite Runbook

When (and how) to legitimately edit an already-applied migration file.

> Quick links:
> [`backend-rust/src/db/migrations.rs`](../backend-rust/src/db/migrations.rs)
> · [`backend-rust/migrations/`](../backend-rust/migrations/)
> · [`docs/restore-runbook.md`](./restore-runbook.md)

## TL;DR

```
1. Confirm the rewrite is schema-equivalent (no behavior change).
2. Diff the schema before and after on a copy of prod.
3. Add the version to `REBRIDGED_MIGRATIONS` in
   `backend-rust/src/db/migrations.rs` with a `reason` string.
4. Get both pieces (the SQL file and the rebridge entry) reviewed
   together by a second pair of eyes.
5. Verify on staging before merging to main.
```

## Background

`sqlx::migrate!` stores a SHA-384 checksum of every applied migration in
`_sqlx_migrations.checksum`. On the next startup it verifies that the
embedded migration source matches what was applied; if the source has
changed it refuses to proceed with:

```
migration <version> was previously applied but has been modified
```

The `bridge_modified_migration_checksums` function in
`backend-rust/src/db/migrations.rs` is the escape hatch: when an entry
is added to the `REBRIDGED_MIGRATIONS` array, the recorded checksum is
silently updated to match the current source on the next boot, without
re-running the SQL. This is dangerous if misused — the rewrite must be
genuinely schema-equivalent.

## When a rewrite is legitimate

- **Canonical reconciliation**. Two long-running environments
  (production and staging) diverged because someone hand-applied a
  partial schema change; you're now rewriting the file to be the single
  truth that produces the same end-state on both.
- **Idempotence refactor**. Replacing `ADD COLUMN` with
  `ADD COLUMN IF NOT EXISTS` so a failed deploy can retry. The
  end-state schema is identical.
- **Comment / whitespace cleanup**. Same SQL, prettier.

## When a rewrite is **not** legitimate (do not rebridge)

- Adding a new column / table / index → write a **new migration** with
  a new timestamp.
- Dropping or renaming a column / table → write a new migration; never
  retroactively edit history.
- Changing a column type → write a new migration that does the
  conversion.
- "Fixing" a bug in stored-procedure logic → write a new migration that
  `CREATE OR REPLACE`s the function.

If you find yourself wondering "is this safe to rebridge?", the answer
is almost certainly no. Write a new migration.

## Procedure

### 1. Verify schema-equivalence on a copy of prod

```bash
# Pull a recent backup (docs/restore-runbook.md § "Pick the dump").
# Restore into a throwaway local DB.
psql -c 'CREATE DATABASE before_rewrite;' postgres
psql -d before_rewrite -f /tmp/restore.sql

# Capture the pre-rewrite schema.
pg_dump --schema-only --no-owner --no-acl -d before_rewrite > /tmp/before.sql

# Apply your rewritten migration to a fresh DB initialised from the
# CURRENT migrations directory.
createdb after_rewrite
for f in backend-rust/migrations/*.sql; do
  psql -d after_rewrite -v ON_ERROR_STOP=1 -f "$f"
done
pg_dump --schema-only --no-owner --no-acl -d after_rewrite > /tmp/after.sql

# Diff. Acceptable noise: comment changes, ordering of independent
# items, whitespace. Anything structural is a STOP.
diff -u /tmp/before.sql /tmp/after.sql | less
```

If the diff shows any column / index / type / constraint change, your
rewrite is **not** schema-equivalent and rebridging is unsafe.

### 2. Add the rebridge entry

Edit `backend-rust/src/db/migrations.rs`:

```rust
const REBRIDGED_MIGRATIONS: &[(i64, &str)] = &[
    (
        20260511000000,
        "PR #215 canonical booking_slips reconciliation",
    ),
    // Add yours below with a one-line reason for future operators.
    (
        20260601120000,
        "PR #999 idempotence refactor of booking_admin_fields",
    ),
];
```

The `reason` string is what shows up in staging / production startup
logs:

```
Rebridging modified migration checksum (schema unchanged, source edited)
  version=20260601120000  reason="PR #999 ..."
```

### 3. Regenerate the sqlx offline cache

The rewritten SQL is parsed at compile time. If the rewrite changes any
query shape, regenerate:

```bash
backend-rust/scripts/regen-sqlx-cache.sh
git add backend-rust/.sqlx/
```

CI verifies the cache with `cargo sqlx prepare --check` — skipping this
will fail the build.

### 4. Two-piece code review

The PR must include **both**:
- the rewritten migration SQL file, and
- the entry in `REBRIDGED_MIGRATIONS`.

A reviewer cannot evaluate one without the other. PR description must
link to the schema diff from step 1.

### 5. Verify on staging before merging

Push to a feature branch, open the PR, and wait for the staging deploy
to succeed. Specifically watch for the
`Rebridging modified migration checksum` info log in
`Verify Staging → backend.log` (the post-merge log capture from
`ci-build-e2e.yml`).

If staging boots clean and `/api/health` returns 200, the rebridge
worked. If staging refuses to boot with
`migration X was previously applied but has been modified`, either:
- the rebridge entry has a typo in the version number, or
- staging's `_sqlx_migrations` row has a checksum that matches neither
  the old nor new source (manual prior intervention) — investigate by
  hand; do not "fix forward" by adding another rebridge entry.

### 6. Document in the PR description and CHANGELOG

```
- migration N rewrite: <one-line reason>
- rebridge entry added with the same `reason` string
- schema diff (no structural changes): <link to gist / artifact>
- staging boot log line confirming rebridge: <link>
```

## What if rebridging breaks staging

`docs/rollback-runbook.md` § "Steps — code + DB rollback" is the path.
Staging refuses to boot is a clear signal; production is gated behind a
manual approval that should not be clicked.

If you somehow merged a broken rebridge to `main` and production tried
to apply it:

1. Production startup fails before the new image takes traffic.
2. The previous (good) image keeps running because docker compose's
   `restart: unless-stopped` policy doesn't tear it down until the new
   one is healthy.
3. Roll back as in the rollback runbook, then revert the bad PR.

## History

| When        | Rebridged version    | Reason                                                |
| ----------- | -------------------- | ----------------------------------------------------- |
| 2026-05-11  | `20260511000000`     | PR #215 canonical booking_slips reconciliation        |
