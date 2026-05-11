# ==============================================================================
# Stage 1: Chef - Install cargo-chef for dependency caching
# ==============================================================================
FROM rust:1.95-trixie AS chef

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/* \
    && cargo install cargo-chef --locked

WORKDIR /app

# ==============================================================================
# Stage 2: Planner - Generate recipe.json for dependency caching
# ==============================================================================
FROM chef AS planner

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
COPY .cargo ./.cargo

RUN cargo chef prepare --recipe-path recipe.json

# ==============================================================================
# Stage 3: Builder - Build dependencies then source code
# ==============================================================================
FROM chef AS builder

# Copy the recipe and cook dependencies (this layer is cached)
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# Copy source code and build the application
COPY Cargo.toml Cargo.lock ./
COPY .cargo ./.cargo
COPY .sqlx ./.sqlx
COPY src ./src
COPY migrations ./migrations

RUN cargo build --release --bin loyalty-backend --bin healthcheck

# ==============================================================================
# Stage 4: Development - Full development environment with hot reload
# ==============================================================================
FROM rust:1.95-trixie AS development

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    libpq-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && cargo install cargo-watch --locked

WORKDIR /app

# Copy Cargo files for dependency resolution
COPY Cargo.toml Cargo.lock ./

# Create src directory structure for initial build
COPY src ./src

ENV RUST_LOG=debug
ENV RUST_BACKTRACE=1

EXPOSE 4001

# Use cargo-watch for hot reload during development
CMD ["cargo", "watch", "-x", "run"]

# ==============================================================================
# Stage 5: Runner - Minimal production image (Distroless)
# ==============================================================================
# Base: gcr.io/distroless/cc-debian12 (the "cc" runtime)
#
# What ships in cc-debian12:
#   - glibc, libgcc_s, libstdc++           (the "cc" C/C++ runtime)
#   - libssl3, libcrypto3                  (needed by openssl-sys → native-tls
#                                            → lettre / async-native-tls / reqwest)
#   - ca-certificates                      (system trust store at /etc/ssl/certs/)
#   - a built-in `nonroot` user            (uid/gid 65532)
#
# What does NOT ship:
#   - any shell, package manager, or `curl`
#   - libpq                                (sqlx uses its pure-Rust postgres
#                                            driver, so this is not a problem)
#
# Why Distroless:
#   - Drops ~50 OS-level Trivy alerts that linger on debian:trixie-slim
#     (apt, dpkg, perl-base, libssh, libgnutls etc. all gone).
#   - Smaller attack surface: no shell means no shell injection / no `apt`
#     compromise vector / no curl/wget exfiltration tools.
#   - Smaller image (~25MB runtime vs ~80MB for trixie-slim with deps).
#
# Healthcheck:
#   The standard `curl -f /api/health` healthcheck cannot run in Distroless
#   (no shell, no curl). Replaced by the dedicated `healthcheck` binary
#   built from `src/bin/healthcheck.rs` in the builder stage above. The
#   docker-compose.prod.yml healthcheck calls `/app/healthcheck` directly.
FROM gcr.io/distroless/cc-debian12 AS runner

WORKDIR /app

# Copy the compiled binaries from the builder. Both are owned by the
# built-in `nonroot` user (uid/gid 65532) so we don't need a chown layer.
COPY --from=builder --chown=nonroot:nonroot /app/target/release/loyalty-backend /app/loyalty-backend
COPY --from=builder --chown=nonroot:nonroot /app/target/release/healthcheck    /app/healthcheck

# Drop privileges. cc-debian12 ships the `nonroot` user as uid/gid 65532.
# (Previous image used a manually-created `appuser` at uid/gid 1000.
# This is a BREAKING CHANGE for any host bind mount that relied on uid 1000;
# the production deployment uses named docker volumes only, so no impact.)
USER nonroot:nonroot

ENV RUST_LOG=info
ENV RUST_BACKTRACE=0

EXPOSE 4001

# No HEALTHCHECK directive: the docker-compose.prod.yml `healthcheck:` block
# overrides anything set here at runtime, so we keep the contract in one
# place (the compose file) instead of duplicating it.

CMD ["/app/loyalty-backend"]
