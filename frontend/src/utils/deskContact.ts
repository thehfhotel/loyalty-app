import type { Property } from '../services/channelBookingService';

/**
 * The desk phone number a guest is told to call.
 *
 * These are BUILD-TIME substitutions, not runtime configuration: Vite
 * statically replaces `import.meta.env.VITE_*` when the bundle is built. The
 * wiring is in place — `frontend/Dockerfile` takes
 * `VITE_DESK_PHONE_HF` / `VITE_DESK_PHONE_HFVILLE` as build args and
 * `ci-build-e2e.yml` fills them from the repository variables
 * `DESK_PHONE_HF` / `DESK_PHONE_HFVILLE` (#414) — so a number change is a
 * variable edit plus a rebuild, and editing the running container's
 * environment does nothing.
 *
 * Reading the variables inside the function rather than at module scope
 * buys testability (a test can stub `import.meta.env` per case) and nothing
 * else.
 *
 * A blank variable still answers null, and callers must render a "contact
 * the front desk" line WITHOUT a number in that case rather than hide the
 * fallback altogether: a local build, a preview, or a property whose number
 * has not been set yet must still leave a guest a way out.
 */
export function deskPhone(property: Property | null | undefined): string | null {
  if (!property) {
    return null;
  }
  const raw =
    property === 'hf'
      ? import.meta.env.VITE_DESK_PHONE_HF
      : import.meta.env.VITE_DESK_PHONE_HFVILLE;
  const trimmed = (raw ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `tel:` href for a desk number, with spaces and dashes stripped. */
export function deskPhoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
