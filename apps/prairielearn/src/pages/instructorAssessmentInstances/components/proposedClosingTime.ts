import { Temporal } from '@js-temporal/polyfill';

import { formatDate } from '@prairielearn/formatter';

export type TimeLimitAction =
  | 'set_total'
  | 'set_rem'
  | 'set_exact'
  | 'add'
  | 'subtract'
  | 'remove'
  | 'expire';

/** Shown when the entered minutes value can't produce a valid closing time. */
export const PROPOSED_CLOSING_TIME_PLACEHOLDER = '—';

/**
 * Compute the human-readable closing time the form would set, given the selected
 * action and the number of minutes entered. Returns null when there is no total
 * time to base it on.
 *
 * The minutes field is free-form: clearing it (e.g. Backspace) makes the value
 * `NaN`, and an out-of-range value overflows Temporal — both make Temporal's
 * `.add()`/`.subtract()` throw. Since this runs during render, an unhandled throw
 * blanks the popover (issue 14640). Return a placeholder instead of throwing.
 */
export function computeProposedClosingTime({
  action,
  timeAddMinutes,
  totalTimeSec,
  startDateIso,
  timezone,
}: {
  action: TimeLimitAction;
  timeAddMinutes: number;
  totalTimeSec: number | null;
  startDateIso: string;
  timezone: string;
}): string | null {
  if (totalTimeSec == null) return null;
  try {
    const totalTime = Math.round(totalTimeSec);

    let startDate = Temporal.Instant.from(startDateIso).toZonedDateTimeISO(timezone);
    if (action === 'set_total') {
      startDate = startDate.add({ minutes: timeAddMinutes });
    } else if (action === 'set_rem') {
      startDate = Temporal.Now.zonedDateTimeISO(timezone).add({ minutes: timeAddMinutes });
    } else if (action === 'add') {
      startDate = startDate.add({ seconds: totalTime }).add({ minutes: timeAddMinutes });
    } else if (action === 'subtract') {
      startDate = startDate.add({ seconds: totalTime }).subtract({ minutes: timeAddMinutes });
    }

    return formatDate(new Date(startDate.epochMilliseconds), timezone);
  } catch {
    return PROPOSED_CLOSING_TIME_PLACEHOLDER;
  }
}
