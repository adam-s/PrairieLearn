import { assert, describe, it } from 'vitest';

import { makeGradingResult } from './externalGraderCommon.js';

// RED→GREEN at the public ingestion boundary, written so it also COMPILES AND
// RUNS on the base branch (it imports only `makeGradingResult`, which exists
// there). Each case feeds a genuinely-malformed envelope that the base's ad-hoc
// checks IGNORE — passing the bad value straight through as a success — and
// asserts that, with the Zod schema, the result is instead rejected as a clear
// grading failure. On base these assertions FAIL (malformed input is silently
// accepted); with the fix they PASS.
describe('makeGradingResult rejects malformed envelopes the ad-hoc parser ignored', () => {
  it('rejects a non-string timing field (base: silently accepted as a success)', () => {
    const result = makeGradingResult('1', {
      succeeded: true,
      start_time: 12345, // must be an ISO string; base passes it through unchecked
      results: { score: 1 },
    });
    // GREEN (fix): rejected -> failure feedback. RED (base): succeeded === true.
    assert.isFalse(
      (result.grading.feedback as any).succeeded,
      'expected malformed timing field to be rejected',
    );
  });

  it('rejects a non-boolean results.gradable (base: silently accepted as a success)', () => {
    const result = makeGradingResult('1', {
      succeeded: true,
      results: { score: 1, gradable: 'sure' }, // must be boolean; base never checks it
    });
    assert.isFalse(
      (result.grading.feedback as any).succeeded,
      'expected malformed results.gradable to be rejected',
    );
  });

  it('rejects a malformed results.format_errors type (base: silently dropped)', () => {
    const result = makeGradingResult('1', {
      succeeded: true,
      results: { score: 1, format_errors: { unexpected: 'object' } }, // string | string[] only
    });
    assert.isFalse(
      (result.grading.feedback as any).succeeded,
      'expected malformed results.format_errors to be rejected',
    );
  });
});

// Guardrail: the schema must NOT have made the parser stricter for shapes real
// graders legitimately produce. These pass on BOTH base and fix.
describe('makeGradingResult still accepts every legitimate grader shape', () => {
  it('accepts a minimal gradable success', () => {
    const result = makeGradingResult('1', { succeeded: true, results: { score: 1 } });
    assert.isTrue((result.grading.feedback as any).succeeded);
    assert.equal(result.grading.score, 1);
  });

  it('accepts a non-gradable result (gradable false, no score)', () => {
    const result = makeGradingResult('1', {
      succeeded: true,
      results: { gradable: false, format_errors: 'bad input' },
    });
    assert.isTrue((result.grading.feedback as any).succeeded);
    assert.equal(result.grading.score, 0);
  });
});
