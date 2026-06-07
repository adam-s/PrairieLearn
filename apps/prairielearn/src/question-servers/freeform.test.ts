import { assert, describe, it } from 'vitest';

import { renderQuestionTemplate } from './freeform.js';

// Regression test for issue #8859 — "Do not expose students to variants with
// mustache errors". A `question.html` interpolation tag (`{{x}}`, `{{{x}}}`,
// `{{&x}}`) that references a variable that does not exist in `data` is silently
// rendered by Mustache as an empty string, producing a malformed question with
// no signal to the author. `renderQuestionTemplate` must report those names so
// the caller can record a course issue. Section/inverted-section idioms that use
// a missing key as a falsy conditional must NOT be reported.
describe('renderQuestionTemplate missing-variable detection', () => {
  it('reports an interpolation tag that references a missing variable', () => {
    const { html, missingVariables } = renderQuestionTemplate(
      'The capital of {{params.country}} is what?',
      { params: {} },
    );
    // Rendering is unchanged (mustache still emits an empty string)…
    assert.equal(html, 'The capital of  is what?');
    // …but the missing variable is now reported.
    assert.deepEqual(missingVariables, ['params.country']);
  });

  it('reports unescaped ({{{x}}} / {{&x}}) interpolation of a missing variable', () => {
    assert.deepEqual(renderQuestionTemplate('{{{raw}}}', {}).missingVariables, ['raw']);
    assert.deepEqual(renderQuestionTemplate('{{&raw}}', {}).missingVariables, ['raw']);
  });

  it('treats a null value as missing (matches mustache skipping null)', () => {
    assert.deepEqual(renderQuestionTemplate('{{n}}', { n: null }).missingVariables, ['n']);
  });

  it('does not report present values, including empty string / 0 / false', () => {
    assert.deepEqual(renderQuestionTemplate('{{a}}', { a: 'x' }).missingVariables, []);
    assert.deepEqual(renderQuestionTemplate('{{a}}', { a: '' }).missingVariables, []);
    assert.deepEqual(renderQuestionTemplate('{{a}}', { a: 0 }).missingVariables, []);
    assert.deepEqual(renderQuestionTemplate('{{a}}', { a: false }).missingVariables, []);
  });

  it('does not report section / inverted-section idioms over a missing key', () => {
    // `{{#flag}}…{{/flag}}` and `{{^flag}}…{{/flag}}` use a missing key as a
    // falsy conditional — an established, valid Mustache idiom (see #6747).
    assert.deepEqual(
      renderQuestionTemplate('{{#flag}}on{{/flag}}{{^flag}}off{{/flag}}', {}).missingVariables,
      [],
    );
  });

  it('does not report keys resolved through list iteration', () => {
    assert.deepEqual(
      renderQuestionTemplate('{{#items}}{{name}} {{/items}}', {
        items: [{ name: 'a' }, { name: 'b' }],
      }).missingVariables,
      [],
    );
  });

  it('does not report absent members of optional submission/grading containers', () => {
    // Questions routinely interpolate these directly; they are empty before a
    // student submits, so an absent member is idiomatic, not an authoring error.
    const template =
      '{{submitted_answers.c}}{{format_errors.c}}{{feedback.c}}{{correct_answers.c}}' +
      '{{raw_submitted_answers.c}}{{partial_scores.c}}';
    assert.deepEqual(
      renderQuestionTemplate(template, {
        submitted_answers: {},
        format_errors: {},
        feedback: {},
        correct_answers: {},
        raw_submitted_answers: {},
        partial_scores: {},
      }).missingVariables,
      [],
    );
  });

  it('still reports a missing params member (a typical authoring typo)', () => {
    assert.deepEqual(
      renderQuestionTemplate('{{params.country}}', { params: {} }).missingVariables,
      ['params.country'],
    );
  });
});
