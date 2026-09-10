import type { Property } from '../services/channelBookingService';

/**
 * The desk phone number a guest is told to call when a deposit link is
 * expired, revoked, or simply not working.
 *
 * B16 supplies the real numbers; until it does, both variables are blank in
 * every environment and `deskPhone()` returns null. Callers must render a
 * "contact the front desk" line WITHOUT a number in that case rather than
 * hide the fallback altogether — a guest stuck on a payment page always
 * needs a way out, even a vague one.
 *
 * These are BUILD-TIME substitutions, not runtime configuration: Vite
 * statically replaces `import.meta.env.VITE_*` when the bundle is built, so
 * reading them inside the function buys testability (a test can stub
 * `import.meta.env` per case) and nothing else. When B16 supplies the
 * numbers, they have to reach the frontend *build* step in `deploy.yml` and
 * the image has to be rebuilt and redeployed — adding them to the running
 * container's environment changes nothing.
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
