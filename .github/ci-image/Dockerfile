# =============================================================================
# CI runner image for the two Rust jobs in ci-build-e2e.yml.
#
# WHY THIS EXISTS
#   `build-backend-release` and `test-backend-integration` run inside
#   `rust:1.93-bookworm` and then spend the first minute of every run
#   reinstalling the same things:
#
#     Initialize containers      20-59s   (pull rust:1.93-bookworm from Docker Hub)
#     Install system dependencies 3-7s    (apt-get pkg-config libssl-dev libpq-dev ...)
#     Install sqlx-cli            4-5s    (taiki-e/install-action download)
#     Setup sccache               1-2s    (mozilla-actions/sccache-action download)
#     Cache cargo-nextest         1-2s    (actions/cache restore)
#
#   Measured on main run 34485429412, `test-backend-integration` spent 59s on
#   container init alone — 21% of that job — before doing any work. Baking the
#   dependencies in turns all of the above into one GHCR pull of a warm layer.
#
# WHY NOT A DIFFERENT BASE
#   It MUST stay `rust:1.93-bookworm`. The release binary produced here is
#   COPYed into `gcr.io/distroless/cc-debian12` (bookworm, glibc 2.36) by
#   backend-rust/Dockerfile.ci. Building against a newer glibc yields a binary
#   that cannot be loaded at runtime — that is issue #360, which has already
#   bitten this repo once.
#
# HOW IT IS TAGGED
#   ghcr.io/thehfhotel/loyalty-app/ci-rust:<toolchain>-<hash of this file>
#   The tag is derived from this file's content by `ensure-ci-image` in
#   ci-build-e2e.yml, so editing this Dockerfile automatically selects a new
#   tag and that job builds it on first use. Nothing to bump by hand.
#
#   The weekly rebuild in ci-image.yml re-pushes the SAME tag to pick up base
#   image and apt security updates. The tag identifies the recipe, not the
#   exact bytes.
# =============================================================================

FROM rust:1.93-bookworm

# Pinned so a version bump changes this file's hash, and therefore the image
# tag, instead of silently altering what a given tag means.
ARG SCCACHE_VERSION=0.17.0
ARG NEXTEST_VERSION=0.9.78
# Match the `sqlx` crate version in backend-rust/Cargo.lock. `cargo sqlx
# prepare --check` compares against the .sqlx/ cache written by this CLI, so a
# major/minor skew here shows up as a spurious CI failure.
ARG SQLX_CLI_VERSION=0.8.6

# 1. System dependencies — the exact set the two jobs apt-get today.
#    postgresql-client is only needed by test-backend-integration (psql for
#    migrations/seeding) but costs little and keeps one image for both jobs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        pkg-config \
        libssl-dev \
        libpq-dev \
        postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# 2. sccache — same build the mozilla-actions/sccache-action downloads.
#    Kept even though its hit rate is 0% today (see the note in
#    ci-build-e2e.yml): removing RUSTC_WRAPPER would invalidate every
#    rust-cache entry, which is a separate change with its own cold-build cost.
RUN curl -fsSL "https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      -o /tmp/sccache.tar.gz \
    && tar -xzf /tmp/sccache.tar.gz -C /tmp \
    && install -m 0755 "/tmp/sccache-v${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache" /usr/local/cargo/bin/sccache \
    && rm -rf /tmp/sccache* \
    && sccache --version

# 3. cargo-nextest — prebuilt binary, same source as get.nexte.st.
RUN curl -fsSL "https://get.nexte.st/${NEXTEST_VERSION}/linux" -o /tmp/nextest.tar.gz \
    && tar -xzf /tmp/nextest.tar.gz -C /usr/local/cargo/bin \
    && rm -f /tmp/nextest.tar.gz \
    && cargo nextest --version

# 4. sqlx-cli — built from source deliberately. It is slow (minutes), but it
#    happens once per image build, off the pipeline's critical path, instead of
#    ~5s on every single CI run. Only the postgres driver is needed.
RUN cargo install sqlx-cli \
        --version "${SQLX_CLI_VERSION}" \
        --no-default-features \
        --features postgres,rustls \
        --locked \
    && sqlx --version \
    && rm -rf /usr/local/cargo/registry

# Fail the image build rather than the pipeline if a tool is missing.
RUN set -eux; \
    command -v pg_isready; \
    command -v psql; \
    command -v sccache; \
    command -v cargo-nextest; \
    command -v sqlx; \
    command -v cargo-sqlx; \
    pkg-config --exists libssl && echo "libssl ok"; \
    pkg-config --exists libpq && echo "libpq ok"
