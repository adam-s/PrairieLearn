import { assert, describe, it } from 'vitest';

import { type QuestionJsonInput, QuestionJsonSchema } from './infoQuestion.js';

// Minimal valid v3 question; individual tests override only the field under test.
const baseQuestion = (): QuestionJsonInput => ({
  uuid: '11e89892-3eff-4d7f-90a2-221372f14e5c',
  type: 'v3',
  title: 'Test question',
  topic: 'Test',
});

describe('infoQuestion schema field limits', () => {
  describe('workspaceOptions.port', () => {
    const withPort = (port: number): QuestionJsonInput => ({
      ...baseQuestion(),
      workspaceOptions: { image: 'prairielearn/workspace', port, home: '/home/user' },
    });

    it.each([0, 22, 3939, 8080, 65_535])('accepts in-range port %i', (port) => {
      const result = QuestionJsonSchema.safeParse(withPort(port));
      assert.isTrue(result.success);
    });

    it.each([-1, 65_536, 999_999])('rejects out-of-range port %i', (port) => {
      const result = QuestionJsonSchema.safeParse(withPort(port));
      assert.isFalse(result.success);
      assert.isTrue(
        result.error.issues.some(
          (issue) => JSON.stringify(issue.path) === JSON.stringify(['workspaceOptions', 'port']),
        ),
      );
    });

    it('rejects a non-integer port', () => {
      const result = QuestionJsonSchema.safeParse(withPort(8080.5));
      assert.isFalse(result.success);
    });
  });

  describe('externalGradingOptions.timeout', () => {
    const withTimeout = (timeout: number): QuestionJsonInput => ({
      ...baseQuestion(),
      externalGradingOptions: { image: 'prairielearn/grader', timeout },
    });

    it.each([1, 30, 60, 600, 86_400])('accepts in-range timeout %i', (timeout) => {
      const result = QuestionJsonSchema.safeParse(withTimeout(timeout));
      assert.isTrue(result.success);
    });

    it.each([0, -1, 86_401])('rejects out-of-range timeout %i', (timeout) => {
      const result = QuestionJsonSchema.safeParse(withTimeout(timeout));
      assert.isFalse(result.success);
      assert.isTrue(
        result.error.issues.some(
          (issue) =>
            JSON.stringify(issue.path) === JSON.stringify(['externalGradingOptions', 'timeout']),
        ),
      );
    });

    it('rejects a non-integer timeout', () => {
      const result = QuestionJsonSchema.safeParse(withTimeout(30.5));
      assert.isFalse(result.success);
    });
  });
});
