# ==============================================================================
# Stage 1: Chef - Install cargo-chef for dependency caching
# ==============================================================================
FROM rust:1.85-bookworm AS chef

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
COPY src ./src

RUN cargo build --release --bin loyalty-backend

# ==============================================================================
# Stage 4: Development - Full development environment with hot reload
# ==============================================================================
FROM rust:1.85-bookworm AS development

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
# Stage 5: Runner - Minimal production image
# ==============================================================================
FROM debian:bookworm-slim AS runner

# Install only required runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && rm -rf /var/cache/apt/archives/*

# Create non-root user for security
RUN groupadd --gid 1000 appgroup \
    && useradd --uid 1000 --gid appgroup --shell /bin/bash --create-home appuser

WORKDIR /app

# Copy only the compiled binary from builder
COPY --from=builder /app/target/release/loyalty-backend /app/loyalty-backend

# Set ownership to non-root user
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Set environment variables
ENV RUST_LOG=info
ENV RUST_BACKTRACE=0

EXPOSE 4001

# Health check using curl to hit the health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:4001/health || exit 1

# Run the binary
CMD ["/app/loyalty-backend"]
