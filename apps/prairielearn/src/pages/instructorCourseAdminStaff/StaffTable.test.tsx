import { describe, expect, it } from 'vitest';

import { summarizeAddUsersResult } from './StaffTable.js';

// Regression test for issue #5283: adding course staff with a UID that resolves to
// no known user (truncated / wrong-format / never-logged-in) used to succeed
// silently — the modal closed with no message and the person only later appeared as
// a red "Unknown user" in the roster. The add-users success handler now surfaces
// those UIDs and keeps the modal open. `summarizeAddUsersResult` is the pure
// decision that drives that behavior.
describe('summarizeAddUsersResult', () => {
  it('keeps the modal open and reports unknown users that were added', () => {
    const summary = summarizeAddUsersResult({
      errors: [],
      unknownUsers: ['truncated_staff'],
    });
    // The pre-fix bug: a result with only unknown users (no hard errors) closed the
    // modal silently. The fix must NOT close, and must report the unknown UIDs.
    expect(summary.shouldClose).toBe(false);
    expect(summary.unknownUsers).toEqual(['truncated_staff']);
    expect(summary.errors).toEqual([]);
  });

  it('keeps the modal open and reports hard errors', () => {
    const summary = summarizeAddUsersResult({
      errors: ['Failed to give course content access to bad@example.com'],
      unknownUsers: [],
    });
    expect(summary.shouldClose).toBe(false);
    expect(summary.errors).toHaveLength(1);
  });

  it('reports both errors and unknown users together', () => {
    const summary = summarizeAddUsersResult({
      errors: ['Failed to give course content access to bad@example.com'],
      unknownUsers: ['truncated_staff'],
    });
    expect(summary.shouldClose).toBe(false);
    expect(summary.errors).toHaveLength(1);
    expect(summary.unknownUsers).toEqual(['truncated_staff']);
  });

  it('closes the modal on a fully clean add (all UIDs matched known users)', () => {
    const summary = summarizeAddUsersResult({
      errors: [],
      unknownUsers: [],
    });
    // The sibling case that must keep working: a valid, known UID is added with no
    // warning and the modal closes as before.
    expect(summary.shouldClose).toBe(true);
    expect(summary.errors).toEqual([]);
    expect(summary.unknownUsers).toEqual([]);
  });
});
