# Dependabot triage — 2026-09-10

Read-only triage of the 8 open Dependabot PRs (`gh pr list --author app/dependabot --state open`)
and the 10 open Dependabot security alerts (`gh api repos/thehfhotel/loyalty-app/dependabot/alerts?state=open`).
No PR was merged, closed, pushed to, or otherwise modified while gathering this data.

**Runtime scope first:** of the 8 open PRs, only **#390** (distroless base image digest) touches the
production runtime container. Every other PR is dev/test/CI-only — none of them ship into the
`loyalty-backend` binary or the built frontend bundle.

## Summary table

| PR | Package | From → To | Scope | Semver | CI | Verdict |
|----|---------|-----------|-------|--------|----|---------|
| [#383](https://github.com/thehfhotel/loyalty-app/pull/383) | `uuid` | 14.0.0 → 14.0.1 | test/e2e-only — root `package.json` is the Playwright E2E manifest (dependabot.yml: "Root (Playwright E2E) Dependencies"); `uuid` sits under its `dependencies` key only because npm requires one, not because it ships anywhere. Not imported directly in `tests/**` (only string literals like `'test-uuid'`). | patch | green | **merge-ready** |
| [#384](https://github.com/thehfhotel/loyalty-app/pull/384) | `actions/cache` | 5.1.0 → 6.1.0 | CI-only (GitHub Actions workflow step) | major (5→6) | green | **merge-ready** |
| [#385](https://github.com/thehfhotel/loyalty-app/pull/385) | `jsdom` | 27.4.0 → 29.1.1 | dev/test-only — `frontend/package.json` `devDependencies` (vitest's `environment: 'jsdom'`) | major (27→29) | green | **merge-ready** |
| [#386](https://github.com/thehfhotel/loyalty-app/pull/386) | `fake` | 2.10.0 → 5.1.0 | dev/test-only — `backend-rust/Cargo.toml` `[dev-dependencies]` (currently pinned `"2.9"`), and **unused**: zero `fake::`/`use fake` call sites anywhere in `backend-rust/src` or `backend-rust/tests` | major (2→5) | green (cargo audit, build, unit, integration all pass) | **merge-ready** |
| [#390](https://github.com/thehfhotel/loyalty-app/pull/390) | `distroless/cc-debian12` | digest `e8e7ee4b…` → `6e1871c3…` | **RUNTIME** — `backend-rust/Dockerfile` + `Dockerfile.ci` production runner base image | patch-equivalent (digest refresh, same `cc-debian12` tag) | red: `scan-filesystem` FAILURE — **stale**, see note | **merge-ready** (update branch first, see note) |
| [#394](https://github.com/thehfhotel/loyalty-app/pull/394) | `fast-uri` | 3.1.4 → 3.1.7 | dev/test-only — `frontend/package.json` `devDependencies` tree, transitive (GitHub alert `scope: development`, `relationship: transitive`) | patch | red: `scan-filesystem` FAILURE — **stale**, see note | **merge-ready** (update branch first, see note) |
| [#397](https://github.com/thehfhotel/loyalty-app/pull/397) | `@humanfs/node` | 0.16.7 → 0.16.8 | dev/test-only — `frontend/package.json` `devDependencies` tree, transitive (ESLint's fs utility) | patch | red: `scan-filesystem` FAILURE — **stale**, see note | **merge-ready** (update branch first, see note) |
| [#401](https://github.com/thehfhotel/loyalty-app/pull/401) | `vitest` | 4.1.10 → 5.0.0 | dev/test-only — `frontend/package.json` `devDependencies` (test runner) | major (4→5) | **red**: `npm ci` ERESOLVE — real failure, not stale | **needs-code-change**: bump `@vitest/coverage-v8` (still pinned `^4.1.10`) to `^5.0.0` in the same commit |

## Cross-check against open Dependabot alerts

All 10 open alerts are `npm`, `scope: development`, on `frontend/package-lock.json` — none touch a
runtime dependency:

| Alert(s) | Package | Fixed in | Covered by |
|---|---|---|---|
| #222, #221, #218, #217, #212 | `fast-uri` (installed 3.1.4) | 3.1.5 (#212) / 3.1.6 (rest) | **#394** (→ 3.1.7, satisfies all) |
| #225, #224 | `vitest` / `@vitest/mocker` (installed 4.1.10) | 4.1.11 | **#401** (→ 5.0.0, satisfies range, but see needs-code-change above) |
| #220 | `@humanfs/node` (installed 0.16.7) | 0.16.8 | **#397** |
| #226, #213 | `js-yaml` (installed 4.3.0, direct `frontend` devDependency `^4.3.0`) | 4.3.1 / 4.3.2 | **no open PR.** The manifest range `^4.3.0` already permits the fix, so Dependabot likely won't open a version-bump PR — this needs a plain `npm update js-yaml` + lockfile commit, or a manual PR, to close alerts #226/#213. Flagging as a gap, not part of the 8 PRs above. |

## Stale-CI note (#390, #394, #397)

`scan-filesystem` (Trivy Container Scan workflow) is failing on these three PRs for a reason
**unrelated to the dependency each PR bumps**: their branches were opened against a base commit that
predates `nanoid` 3.3.16→3.3.18 (fixed on `main` by PR **#398**, merged 2026-09-10, CVE-2026-67213,
HIGH). The job log for #397 shows the exact finding:

```
frontend/package-lock.json (npm)
Total: 1 (HIGH: 1, CRITICAL: 0)
nanoid  CVE-2026-67213  HIGH  fixed  3.3.16  3.3.18, 5.1.6  ...infinite loop in random ID generation
```

Verified against git history: base commits `eaffc97c` (#394, #397, 2026-08-28) and `ecd4c0b5` (#390,
2026-08-14) do **not** contain `0b54e90c` (the nanoid fix); only #401's base (`6a83104b`,
2026-09-10) does. Recommend `gh pr update-branch` on #390, #394, #397 before merging — pulling in
current `main` resolves the nanoid finding and gives a fresh, accurate CI run instead of a
month-old one. (#383/#384/#385/#386 are also stale — based on `main` as of 2026-07-28, six weeks
behind tip — but their last CI run predates *and* passed independent of this issue; updating their
branches is still good hygiene before merge, just not blocking.)

## Migration notes for majors

### #401 — vitest 4.1.10 → 5.0.0 (needs-code-change)
Root cause of the red CI (`Lint Frontend`, `Frontend Unit Tests`, `Build & Push to GHCR` all fail
identically at the `npm ci` step):

```
npm error While resolving: @vitest/coverage-v8@4.1.10
npm error Found: vitest@5.0.0 ... peer vitest@"4.1.10" from @vitest/coverage-v8@4.1.10
```

Dependabot bumped `vitest` alone; `@vitest/coverage-v8` is still pinned `^4.1.10` and peer-requires
`vitest@4.1.10` exactly, so `npm ci` fails before any test runs. **Fix:** bump
`@vitest/coverage-v8` to `^5.0.0` alongside `vitest` in the same change (and any other `@vitest/*`
devDependency added later).

Once that's fixed, the vitest 5 breaking changes worth a second look before trusting green CI:
- `vite` is already `7.3.5` in the lockfile, satisfying v5's new "Require Node.js 22 and Vite 6.4"
  floor — not a blocker.
- "Clear mocks by default before each test" (new implicit `clearMocks: true`) — `frontend/src/test/setup.ts`
  currently does `vi.clearAllTimers()` / `vi.restoreAllMocks()` in `afterEach`/`afterAll` but does not
  set `clearMocks`, so this is a genuine behavior change; run the full suite after the coordinated
  bump to catch any test relying on mock state surviving across calls within a file.
- "Represent locator as an object instead of a string" and "Remove webdriverio package" only affect
  Vitest Browser Mode; this repo uses `environment: 'jsdom'` (see `frontend/vitest.config.ts`), not
  browser mode — not applicable.
- "Don't lookup config file from ancestor directories" — `vitest.config.ts` already lives directly in
  `frontend/`, so config discovery is unaffected.

### #385 — jsdom 27.4.0 → 29.1.1 (merge-ready)
The only item under "Breaking changes" in the release notes is "Node.js v22.13.0+ is now the minimum
supported v22 version" — CI runs Node 24, satisfied. The rest of the changelog is internal
`CSSStyleDeclaration`/`CSSStyleSheet`/`@media` bug fixes that `frontend/src/test/setup.ts` doesn't
touch (it only mocks `matchMedia`/`IntersectionObserver` and polyfills `DataTransfer`/`DragEvent`
behind an `undefined` guard). CI is green.

### #386 — fake 2.10.0 → 5.1.0 (merge-ready)
`fake` is a `[dev-dependencies]` crate in `backend-rust/Cargo.toml` (pinned `"2.9"`) with **zero**
call sites — `grep -rn "fake::" backend-rust --include="*.rs"` (excluding `target/`) returns nothing;
every "fake" hit in the tree is a variable name (`fake_id`, `fake_booking_id`, a string literal
`"fake pdf content"`), not the crate's API. There is no code path this major bump can break. CI
(`cargo audit`, build, unit, integration) is already green. Consider a follow-up cleanup PR to drop
the unused dependency entirely rather than continuing to bump it.

### #384 — actions/cache 5.1.0 → 6.1.0 (merge-ready)
v6.0.0 migrated the action's internals to ESM; v6.1.0 adds handling for cache writes on a
read-only-scoped token. Neither changes the action's input schema or cache-key semantics. The PR
diff updates all 4 in-repo references consistently — two `actions/cache` steps ("Cache
cargo-nextest") in `ci-build-e2e.yml` and two ("Restore frontend dependencies") in `ci-test.yml` —
to the same `v6.1.0` SHA, so no workflow is left mixed on v5. `Swatinem/rust-cache@v2` (used for the
cargo registry/target caches, same two workflow files) is a separate, unrelated action that this PR
doesn't touch and doesn't share cache keys with the cargo-nextest-binary cache — no interaction
risk. CI is green.

### #390 — distroless/cc-debian12 digest bump (merge-ready, runtime scope)
Digest-only change (`e8e7ee4b8b106d4c5fde9e422a321b2b8a2d5cca546c97adcce927f3e1d36e36` →
`6e1871c34683dc9ee996d13084497783fd98ac0200213d0826625f4e9d4be1d0`), same repository and tag
(`gcr.io/distroless/cc-debian12`) in both `backend-rust/Dockerfile` and `backend-rust/Dockerfile.ci`
(kept in lockstep by the PR — both files change together). Base OS stays Debian 12 "bookworm" →
**glibc 2.36**, per the Dockerfile's own Stage 5 comment and the `Dockerfile.ci` header comment. The
actual production build path (`ci-build-e2e.yml` → `build-backend-release` job → packaged by
`Dockerfile.ci`) compiles both `loyalty-backend` and `healthcheck` inside a `rust:1.93-bookworm`
container — same glibc 2.36 as the runner — so there's no build/runtime libc skew introduced by
this bump.

Repo issue **#360** exists ("Backend Docker HEALTHCHECK is unverified by any gate") but is about a
different, already-addressed concern: `Dockerfile.ci`'s own comment explains that the healthcheck
binary used to be vendored and cross-compiled in `rust:1.97-slim`/trixie (glibc 2.41) then shipped
into bookworm (glibc 2.36) — a real skew — and issue #360's fix moved that binary into the same
`rust:1.93-bookworm` build as `loyalty-backend`, eliminating it. This PR doesn't reintroduce that
skew; it's a same-OS digest refresh only.

Trivy's `Scan Backend Image` / `Scan Frontend Image` jobs show `SKIPPED` on this PR (they only run
on push to `main`, not on pull requests), so this PR gets no image-content Trivy scan of its own;
the `scan-filesystem` job that *does* run on PRs failed for the unrelated stale-nanoid reason
documented above, not because of the digest bump.

## Ordered merge-ready list (safest first)

1. **#383** — `uuid` patch bump in the E2E-only manifest; package isn't even imported directly in
   test specs. Zero risk.
2. **#397** — `@humanfs/node` patch bump, ESLint's fs utility, dev-only. CI failure is the
   unrelated stale-nanoid finding (see note); update branch, then merge.
3. **#394** — `fast-uri` patch bump, transitive dev-only dependency. Same stale-nanoid CI caveat;
   update branch, then merge.
4. **#385** — `jsdom` major bump, dev-only (test environment). Release notes' one breaking change
   (Node 22.13+) is already satisfied by CI's Node 24; CI is green.
5. **#384** — `actions/cache` major bump, CI-only. All 4 references updated together to the same
   version; unrelated `Swatinem/rust-cache` untouched; CI green.
6. **#386** — `fake` major bump (2.10→5.1), backend dev-dependency confirmed **unused** anywhere
   in `backend-rust/src` or `backend-rust/tests` — no call site exists that a breaking API change
   could hit. CI green.
7. **#390** — distroless digest bump, the one **runtime**-scope PR. Same base tag/OS
   (`cc-debian12`/bookworm/glibc 2.36), build container already matches (glibc 2.36), no skew.
   Merge last among the safe ones since it's the only PR that touches the production image; update
   branch first (stale-nanoid `scan-filesystem` red), and confirm the staging deploy step
   (`Deploy to Staging` / `Verify Staging` in `ci-build-e2e.yml`) goes green post-merge before
   calling it done.

**Held back:** **#401** (`vitest` 4→5) — needs `@vitest/coverage-v8` bumped to `^5.0.0` in the same
commit to clear the `npm ci` ERESOLVE conflict; not safe to merge as-is.

**Gap (not a PR):** `js-yaml` alerts #226/#213 have no open Dependabot PR because the frontend
manifest's `^4.3.0` range already permits the fix versions (4.3.1/4.3.2) — worth a manual
`npm update js-yaml` + lockfile commit to close them out.
