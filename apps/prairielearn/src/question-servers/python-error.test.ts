import { assert, describe, it } from 'vitest';

import { extractPythonExceptionSummary, getInstructorErrorMessage } from './python-error.js';

// A representative traceback as captured from the Python worker's stderr. The
// worker exits after printing this, so the only thing the Node side sees
// directly is a generic "child process exited unexpectedly" message; the real
// cause is the final summary line here.
const SERVER_TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "question.html", line 1, in <module>',
  '  File "addNumbers/server.py", line 2, in generate',
  '    raise RuntimeError("deliberately broken generate function")',
  'RuntimeError: deliberately broken generate function',
  '',
].join('\n');

// An element error: the worker attaches a note recording which element was
// being processed via `exc.add_note(...)`, which Rich renders after the
// summary line as a `[NOTE]` line.
const ELEMENT_TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "elements/pl-number-input/pl-number-input.py", line 50, in render',
  "    raise KeyError('answers-name')",
  "KeyError: 'answers-name'",
  '[NOTE] Error occurred while processing element <pl-number-input answers-name="x">',
  '',
].join('\n');

// ANSI-colored output, as produced by the worker's Rich excepthook
// (the \u001b[...m sequences are real SGR escape codes).
const ESC = '\u001b';
const ANSI_TRACEBACK =
  `${ESC}[31mTraceback (most recent call last):${ESC}[0m\n` +
  `  ${ESC}[1mFile "server.py", line 3, in prepare${ESC}[0m\n` +
  `${ESC}[1;31mException${ESC}[0m: ${ESC}[1mRequired attribute 'xyz' missing${ESC}[0m\n`;

describe('extractPythonExceptionSummary', () => {
  it('returns the final exception summary line for a server.py error', () => {
    assert.equal(
      extractPythonExceptionSummary(SERVER_TRACEBACK),
      'RuntimeError: deliberately broken generate function',
    );
  });

  it('appends element notes after the summary line', () => {
    assert.equal(
      extractPythonExceptionSummary(ELEMENT_TRACEBACK),
      "KeyError: 'answers-name'\n" +
        'Error occurred while processing element <pl-number-input answers-name="x">',
    );
  });

  it('strips ANSI color codes from the summary', () => {
    assert.equal(
      extractPythonExceptionSummary(ANSI_TRACEBACK),
      "Exception: Required attribute 'xyz' missing",
    );
  });

  it('returns null when there is no exception summary', () => {
    assert.isNull(extractPythonExceptionSummary(''));
    assert.isNull(
      extractPythonExceptionSummary('Traceback (most recent call last):\n  File "x.py", line 1\n'),
    );
  });
});

describe('getInstructorErrorMessage', () => {
  it('replaces the generic process-exit message with the Python exception', () => {
    // This is exactly the unfriendly message instructors see today.
    const err = Object.assign(
      new Error('CodeCallerNative child process exited unexpectedly, code = 1, signal = null'),
      { data: { outputBoth: SERVER_TRACEBACK } },
    );
    const message = getInstructorErrorMessage(err);
    assert.equal(message, 'RuntimeError: deliberately broken generate function');
    assert.notInclude(message, 'child process exited unexpectedly');
  });

  it('surfaces the element note for element errors', () => {
    const err = Object.assign(
      new Error('CodeCallerNative child process exited unexpectedly, code = 1, signal = null'),
      { data: { outputBoth: ELEMENT_TRACEBACK } },
    );
    assert.equal(
      getInstructorErrorMessage(err),
      "KeyError: 'answers-name'\n" +
        'Error occurred while processing element <pl-number-input answers-name="x">',
    );
  });

  it('falls back to the provided fallback when no traceback is available', () => {
    const err = new Error('Invalid state before generate(): something');
    assert.equal(getInstructorErrorMessage(err), 'Invalid state before generate(): something');
    assert.equal(getInstructorErrorMessage(err, err.toString()), err.toString());
  });

  it('falls back when outputBoth has no recoverable summary', () => {
    const err = Object.assign(new Error('generic'), {
      data: { outputBoth: 'Traceback (most recent call last):\n  File "x.py", line 1\n' },
    });
    assert.equal(getInstructorErrorMessage(err, 'generic fallback'), 'generic fallback');
  });
});
