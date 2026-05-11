# Security Policy

## Reporting a vulnerability

If you discover a vulnerability, please use one of the following private channels:

- **GitHub Security Advisories** (preferred): open a private report at <https://github.com/thehfhotel/loyalty-app/security/advisories/new>. This requires a GitHub account but is the most reliable channel — reports are visible only to maintainers and you can collaborate on the fix in a private fork.
- **Email**: <winut.hf@gmail.com>. Slower, but works without a GitHub account.

Do **not** file a public issue, pull request, or discussion thread.

We aim to:

- Acknowledge your report within **3 business days**
- Provide an initial assessment within **7 business days**
- Coordinate a disclosure timeline with you (typically 90 days)

When reporting, please include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept code is welcome)
- Affected versions or commit SHAs, if known
- Whether you intend to publish your findings, and any preferred timeline

We will credit researchers who follow this policy unless you request anonymity.

## Supported versions

Only `main` is supported. Production runs the latest commit on `main`.
Older releases (if any) receive no security backports.

## Scope

In scope:

- Backend (Rust / Axum) — `backend-rust/`
- Frontend (React) — `frontend/`
- Deployment configuration — `docker-compose*.yml`, `.github/workflows/`

Out of scope:

- Third-party hosted services (GitHub, Cloudflare, OAuth providers, etc.)
- Vulnerabilities requiring physical access to the server
- Denial-of-service via raw resource exhaustion (covered by Cloudflare protections)
- Findings against forked or modified copies of this codebase
- Social engineering of staff or customers

## Safe-harbour

We will not pursue legal action against researchers who:

- Make a good-faith effort to comply with this policy
- Do not access, modify, or delete data beyond what is necessary to demonstrate the vulnerability
- Do not exfiltrate data or disrupt service for other users
- Give us reasonable time to remediate before public disclosure

## Operational runbook

Day-to-day secret rotation, deployment-time secret injection, and incident response are documented in [`docs/secrets-runbook.md`](./docs/secrets-runbook.md).
