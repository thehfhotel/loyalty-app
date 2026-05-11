# Contributing

Thanks for your interest in contributing. This is a one-page guide; for project conventions and architecture detail, see [CLAUDE.md](./CLAUDE.md).

## Code of Conduct

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting bugs and requesting features

- **Bugs and feature requests:** open a [GitHub Issue](https://github.com/thehfhotel/loyalty-app/issues). Please include reproduction steps, expected vs actual behaviour, and your environment.
- **Security vulnerabilities:** do **not** open a public issue. Follow the policy in [SECURITY.md](./SECURITY.md).

## Setting up your environment

```bash
git clone https://github.com/thehfhotel/loyalty-app.git
cd loyalty-app
cp .env.example .env       # fill in dev-only values
docker compose up -d
```

The Rust toolchain is pinned by `backend-rust/rust-toolchain.toml` (currently 1.93). `rustup` will pick it up automatically. Frontend requires Node.js 20+.

## Building

```bash
# Backend
cd backend-rust
cargo build

# Frontend
cd frontend
npm install
```

## Running tests locally

```bash
# Backend (Rust)
cd backend-rust && cargo test

# Frontend (Vitest + lint + typecheck)
cd frontend && npm run lint && npm run typecheck && npm run test
```

End-to-end (Playwright) tests run in CI only because they require port-isolated Docker services. Don't worry about running them locally — CI will exercise them on your PR.

## Branching and commit conventions

- **Trunk-based:** branch from `main`, PR back into `main`. There is no `develop` branch.
- **Branch names:** `feat/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`, `docs/<short-desc>`.
- **Commits:** Conventional Commits style. Allowed prefixes:

  ```
  feat:     New feature
  fix:      Bug fix
  improve:  Enhancement to existing functionality
  refactor: Restructuring without behaviour change
  test:     Add or update tests
  docs:     Documentation only
  chore:    Maintenance, deps, tooling
  ```

- **Don't bypass git hooks** (`--no-verify` is forbidden — see [CLAUDE.md](./CLAUDE.md)). Hooks run formatting, lint, and basic safety checks before commit and push.

## Pull requests

1. Push your branch and open a PR against `main`.
2. Fill in the PR template (description, test plan).
3. CI must be green before review.
4. **Wait for human review and merge.** Auto-merge and self-merge are forbidden, even for "trivial" changes — see [CLAUDE.md](./CLAUDE.md).

If your change touches the database schema, the API surface, or deployment configuration, call that out explicitly in the PR description so reviewers know to look closely.

## Style

- **Rust:** `cargo fmt` + `cargo clippy`; no warnings.
- **TypeScript / React:** ESLint + Prettier as configured in `frontend/`.
- Match existing naming and structure rather than introducing new patterns. If you think a new pattern is warranted, raise it in an issue first.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](./LICENSE)).
