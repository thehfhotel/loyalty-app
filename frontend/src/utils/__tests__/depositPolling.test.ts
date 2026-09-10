import { describe, expect, it } from 'vitest';
import {
  DEPOSIT_FAST_POLL_MS,
  DEPOSIT_FAST_POLL_WINDOW_MS,
  DEPOSIT_SLOW_POLL_MS,
  depositPollIntervalMs,
} from '../depositPolling';
import { DEPOSIT_LINK_STATES } from '../../services/depositLinkService';

const NOW = 1_800_000_000_000;

describe('depositPollIntervalMs', () => {
  it('does not poll before the first response', () => {
    expect(depositPollIntervalMs({ state: undefined, engagedAt: NOW, now: NOW })).toBe(false);
  });

  it('does not poll an untouched awaiting_payment page', () => {
    expect(
      depositPollIntervalMs({ state: 'awaiting_payment', engagedAt: null, now: NOW }),
    ).toBe(false);
  });

  it('polls every 5 seconds for the first two minutes after the guest engages', () => {
    expect(depositPollIntervalMs({ state: 'checking', engagedAt: NOW, now: NOW })).toBe(
      DEPOSIT_FAST_POLL_MS,
    );
    expect(
      depositPollIntervalMs({
        state: 'checking',
        engagedAt: NOW,
        now: NOW + DEPOSIT_FAST_POLL_WINDOW_MS - 1,
      }),
    ).toBe(DEPOSIT_FAST_POLL_MS);
  });

  it('drops to 30 seconds once the two-minute window has passed', () => {
    expect(
      depositPollIntervalMs({
        state: 'checking',
        engagedAt: NOW,
        now: NOW + DEPOSIT_FAST_POLL_WINDOW_MS,
      }),
    ).toBe(DEPOSIT_SLOW_POLL_MS);
  });

  it.each(['confirmed', 'expired', 'revoked'] as const)(
    'stops polling on the terminal state %s',
    (state) => {
      expect(depositPollIntervalMs({ state, engagedAt: NOW, now: NOW })).toBe(false);
    },
  );

  it('keeps polling every non-terminal state in the locked vocabulary', () => {
    const nonTerminal = DEPOSIT_LINK_STATES.filter(
      (state) => !['confirmed', 'expired', 'revoked'].includes(state),
    );
    expect(nonTerminal).toEqual(['awaiting_payment', 'checking']);
    for (const state of nonTerminal) {
      expect(depositPollIntervalMs({ state, engagedAt: NOW, now: NOW })).toBe(
        DEPOSIT_FAST_POLL_MS,
      );
    }
  });
});
