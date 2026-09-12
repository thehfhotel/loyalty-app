/**
 * The named PDPA contact printed on the public privacy notice.
 *
 * F1 §10 Q2 is blunt about why this is a variable and not a string in a
 * locale file: "the current notice says 'the hotel support email or the
 * front desk'. A rights request needs one address that is read." An
 * unnamed contact is the difference between a notice that satisfies PDPA
 * s.23 and one that only looks like it does — so the address arrives from
 * outside the code, and the owner can change who reads it without a
 * developer.
 *
 * BUILD-TIME, exactly like `deskContact.ts` (#414): Vite statically
 * replaces `import.meta.env.VITE_*` when the bundle is built.
 * `frontend/Dockerfile` takes `VITE_PDPA_CONTACT_EMAIL` as a build arg and
 * `ci-build-e2e.yml` fills it from the repository variable
 * `PDPA_CONTACT_EMAIL`. Editing the running container's environment does
 * nothing; it is a variable edit plus a rebuild.
 *
 * Read inside the function rather than at module scope so a test can stub
 * `import.meta.env` per case.
 *
 * **Blank must never be a dead end.** With no address configured the notice
 * falls back to the desk phone and "ติดต่อแผนกต้อนรับ" — a worse answer
 * than a monitored mailbox, but still a way for a guest to exercise a
 * right. A privacy notice whose contact section renders empty is the one
 * failure mode that turns a legal obligation into a broken page.
 */
export function pdpaContactEmail(): string | null {
  const raw = import.meta.env.VITE_PDPA_CONTACT_EMAIL;
  const trimmed = (raw ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `mailto:` href for the configured contact address. */
export function pdpaContactHref(email: string): string {
  return `mailto:${email}`;
}
