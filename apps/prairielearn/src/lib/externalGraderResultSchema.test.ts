import { assert, describe, it } from 'vitest';

import { ExternalGradingResultsSchema } from './externalGraderResultSchema.js';
import { makeGradingResult } from './externalGraderCommon.js';

describe('ExternalGradingResultsSchema', () => {
  describe('accepts every shape a real grader legitimately produces', () => {
    it('accepts a minimal gradable success', () => {
      const result = ExternalGradingResultsSchema.safeParse({
        succeeded: true,
        results: { score: 1 },
      });
      assert.isTrue(result.success);
    });

    it('accepts the full documented results shape (tests/images/output/message + extra keys)', () => {
      // Mirrors the example in docs/externalGrading.md plus arbitrary extra data,
      // which the contract explicitly allows ("you may add any additional data").
      const result = ExternalGradingResultsSchema.safeParse({
        job_id: '42',
        received_time: '2024-01-01T00:00:00.000Z',
        start_time: '2024-01-01T00:00:01.000Z',
        end_time: '2024-01-01T00:00:02.000Z',
        succeeded: true,
        results: {
          gradable: true,
          score: 0.25,
          message: 'Tests completed successfully.',
          output: 'Running tests...\n',
          images: [{ label: 'First Image', url: 'data:image/png;base64,...' }],
          tests: [
            {
              name: 'Test 1',
              description: 'Tests that a thing does a thing.',
              points: 1,
              max_points: 1,
              message: 'No errors!',
              output: 'matched',
            },
          ],
          some_custom_course_field: { anything: ['goes', 1, true] },
        },
        an_unknown_top_level_field: 'tolerated',
      });
      assert.isTrue(result.success);
      // Extra fields survive the parse (passthrough), since the whole envelope
      // is surfaced to students as feedback.
      assert.isTrue(result.success && (result.data as any).results.tests.length === 1);
      assert.isTrue(result.success && (result.data as any).an_unknown_top_level_field === 'tolerated');
    });

    it('accepts a not-gradable result with format_errors as a string', () => {
      const result = ExternalGradingResultsSchema.safeParse({
        succeeded: true,
        results: { gradable: false, format_errors: 'bad input' },
      });
      assert.isTrue(result.success);
    });

    it('accepts a job-level failure with null results and no timing fields', () => {
      const result = ExternalGradingResultsSchema.safeParse({
        succeeded: false,
        results: null,
        message: 'Your grading job did not complete within the time limit.',
        timedOut: true,
      });
      assert.isTrue(result.success);
    });

    it('accepts an omitted/null score (non-gradable submission)', () => {
      const omitted = ExternalGradingResultsSchema.safeParse({ succeeded: true, results: {} });
      const nulled = ExternalGradingResultsSchema.safeParse({
        succeeded: true,
        results: { score: null },
      });
      assert.isTrue(omitted.success);
      assert.isTrue(nulled.success);
    });
  });

  describe('rejects only genuinely malformed grader output', () => {
    it('rejects output missing the required succeeded flag', () => {
      const result = ExternalGradingResultsSchema.safeParse({ results: { score: 1 } });
      assert.isFalse(result.success);
    });

    it('rejects a non-boolean succeeded flag', () => {
      const result = ExternalGradingResultsSchema.safeParse({
        succeeded: 'yes',
        results: { score: 1 },
      });
      assert.isFalse(result.success);
    });

    it('rejects a non-numeric score', () => {
      const result = ExternalGradingResultsSchema.safeParse({
        succeeded: true,
        results: { score: 'a lot' },
      });
      assert.isFalse(result.success);
    });
  });
});

// Integration through the public ingestion boundary: malformed input must be
// rejected with a clear error, while valid input flows through unchanged.
describe('makeGradingResult ingestion (schema-validated)', () => {
  it('rejects malformed grader output (non-boolean succeeded) with a clear error', () => {
    const result = makeGradingResult('1', { succeeded: 'yes', results: { score: 1 } });
    assert.isFalse(result.grading.feedback.succeeded);
    assert.match(
      String((result.grading.feedback as any).message),
      /did not match the expected format/,
    );
  });

  it('rejects a non-numeric score with a clear error', () => {
    const result = makeGradingResult('1', { succeeded: true, results: { score: 'a lot' } });
    assert.isFalse(result.grading.feedback.succeeded);
    assert.match(
      String((result.grading.feedback as any).message),
      /did not match the expected format/,
    );
  });

  it('accepts a valid real-shaped result and reports the score', () => {
    const result = makeGradingResult('1', {
      succeeded: true,
      received_time: '2024-01-01T00:00:00.000Z',
      results: {
        score: 0.5,
        gradable: true,
        message: 'ok',
        tests: [{ name: 'Test 1', points: 1, max_points: 1 }],
      },
    });
    assert.equal(result.grading.score, 0.5);
    assert.isTrue((result.grading.feedback as any).succeeded);
    assert.equal((result.grading.feedback as any).results.tests[0].name, 'Test 1');
  });
});
