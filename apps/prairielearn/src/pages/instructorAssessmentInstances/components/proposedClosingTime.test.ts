import { describe, expect, it } from 'vitest';

import {
  PROPOSED_CLOSING_TIME_PLACEHOLDER,
  computeProposedClosingTime,
} from './proposedClosingTime.js';

const TIMEZONE = 'America/Chicago';
// A fixed assessment start instant keeps the add/set_total/subtract branches deterministic.
const START = '2024-04-10T12:00:00Z';

describe('computeProposedClosingTime', () => {
  it('computes a closing time for a valid number of minutes', () => {
    const result = computeProposedClosingTime({
      action: 'set_total',
      timeAddMinutes: 30,
      totalTimeSec: 0,
      startDateIso: START,
      timezone: TIMEZONE,
    });
    expect(result).not.toBe(PROPOSED_CLOSING_TIME_PLACEHOLDER);
    expect(result).toMatch(/2024/);
  });

  it('returns null when there is no total time to base the closing time on', () => {
    expect(
      computeProposedClosingTime({
        action: 'add',
        timeAddMinutes: 5,
        totalTimeSec: null,
        startDateIso: START,
        timezone: TIMEZONE,
      }),
    ).toBeNull();
  });

  // Regression for issue 14640: clearing the minutes field (Backspace) makes the
  // input NaN. Temporal.add({ minutes: NaN }) threw during render, blanking the popover.
  it('returns a placeholder instead of throwing when the field is cleared (NaN)', () => {
    const args = {
      action: 'add' as const,
      timeAddMinutes: Number.NaN,
      totalTimeSec: 600,
      startDateIso: START,
      timezone: TIMEZONE,
    };
    expect(() => computeProposedClosingTime(args)).not.toThrow();
    expect(computeProposedClosingTime(args)).toBe(PROPOSED_CLOSING_TIME_PLACEHOLDER);
  });

  it('returns a placeholder for an out-of-range value instead of throwing', () => {
    expect(
      computeProposedClosingTime({
        action: 'add',
        timeAddMinutes: 1e15,
        totalTimeSec: 0,
        startDateIso: START,
        timezone: TIMEZONE,
      }),
    ).toBe(PROPOSED_CLOSING_TIME_PLACEHOLDER);
  });
});
