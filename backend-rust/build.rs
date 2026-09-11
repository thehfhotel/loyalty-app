// `sqlx::migrate!("./migrations")` embeds the migration files at compile
// time but does not register the directory with cargo, so a migrations-only
// change (a new file, or the 2026-09-11 rename of a colliding version) does
// not recompile the crate. With CI's warm `target/` cache the release binary
// then ships the OLD migration set: run 34563471927 still hit the duplicate
// `_sqlx_migrations_pkey` after the rename. Tracking the directory is the
// sqlx-documented fix.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
