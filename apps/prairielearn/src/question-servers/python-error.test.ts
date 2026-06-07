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

// A real-shaped traceback for an exception whose MESSAGE spans multiple lines —
// e.g. a configuration/validation error that lists each problem on its own line.
// This is exactly the shape the worker's Rich excepthook emits (captured live):
// a `Traceback (most recent call last)` banner, Rich `path:line in fn` frame
// headers with line-number-gutter source context, then the exception summary —
// whose first line is `ExceptionType: <message line 1>` followed by the message's
// continuation lines. The whole trailing block is the human-readable summary.
const MULTILINE_TRACEBACK = [
  'Traceback (most recent call last)',
  'questions/matrixInput/server.py:24 in generate',
  '  21 def generate(data):',
  '  22     rows = data["params"]["rows"]',
  '  23     cols = data["params"]["cols"]',
  '❱ 24     raise ValueError(',
  '  25         "Invalid configuration for \'pl-matrix-component-input\':\\n"',
  '  26         "  - \'rows\' must be a positive integer\\n"',
  '  27         "  - \'columns\' must be a positive integer"',
  "ValueError: Invalid configuration for 'pl-matrix-component-input':",
  "  - 'rows' must be a positive integer",
  "  - 'columns' must be a positive integer",
  '',
].join('\n');

// The red-team edge: a multi-line message whose own continuation line legitimately
// begins with `File "`. The frame-region heuristic must not mistake that message
// line for a traceback frame header and strip it.
const MESSAGE_MENTIONS_FILE = [
  'Traceback (most recent call last)',
  'questions/loadConfig/server.py:12 in generate',
  '  11 def generate(data):',
  '❱ 12     raise FileNotFoundError(msg)',
  'FileNotFoundError: could not load the question configuration:',
  'File "config.yaml" does not exist in the question directory',
  '',
].join('\n');

// The harder red-team edge (RT-6): a multi-line message whose continuation line is
// a *full CPython location* — `File "data.txt", line 99` — which matches the frame
// header shape exactly. It sits AFTER the type line (inside the message), so it
// must NOT be mistaken for "the last frame"; doing so finds nothing after it and
// returns null, re-creating the original generic-headline bug for a realistic
// config/file-load `ValueError`.
const MESSAGE_MENTIONS_FILE_LINE = [
  'Traceback (most recent call last):',
  '  File "server.py", line 3, in generate',
  '    raise ValueError(msg)',
  'ValueError: parse error in:',
  '  File "data.txt", line 99, here',
  '',
].join('\n');

// The Rich-shape sibling: the in-message continuation is a `path:line in name`
// location (`other.py:10 in foo`) rather than a `File "...", line N`. It likewise
// matches the frame header shape but lives inside the message, so the type line
// and first message line must survive.
const MESSAGE_MENTIONS_RICH_FRAME = [
  'Traceback (most recent call last)',
  'questions/q/server.py:24 in generate',
  '  24     raise ValueError(msg)',
  'ValueError: bad reference at',
  'other.py:10 in foo',
  '',
].join('\n');

// A note whose text itself spans multiple lines: the worker prints it as
// `[NOTE] <first line>` followed by the bare continuation lines (no prefix). The
// `[NOTE] ` scaffolding must be stripped from the first line and must never leak
// into the headline, and the continuation lines must stay grouped with the note.
const MULTILINE_NOTE = [
  'Traceback (most recent call last):',
  '  File "server.py", line 3, in generate',
  '    raise KeyError("x")',
  "KeyError: 'x'",
  '[NOTE] Error processing element <pl-thing>',
  '  while rendering panel "question"',
  '',
].join('\n');

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

  it('keeps the whole multi-line exception summary (type + every message line)', () => {
    // Regression for the multi-line case: the summary spans several lines, so the
    // headline must include the exception TYPE and the full message, not just the
    // last continuation line.
    assert.equal(
      extractPythonExceptionSummary(MULTILINE_TRACEBACK),
      "ValueError: Invalid configuration for 'pl-matrix-component-input':\n" +
        "  - 'rows' must be a positive integer\n" +
        "  - 'columns' must be a positive integer",
    );
  });

  it('does not strip a message continuation that begins with `File "`', () => {
    // A continuation line that legitimately starts with `File "` must stay part of
    // the message — only true frame headers (`File "...", line N`) are scaffolding.
    assert.equal(
      extractPythonExceptionSummary(MESSAGE_MENTIONS_FILE),
      'FileNotFoundError: could not load the question configuration:\n' +
        'File "config.yaml" does not exist in the question directory',
    );
  });

  it('keeps a message continuation that is a full `File "...", line N` location', () => {
    // RT-6 regression: a CPython-style `File "...", line N` inside the message must
    // not be mistaken for the last frame. The whole type + message block survives,
    // rather than collapsing to null (which fell back to the generic headline).
    assert.equal(
      extractPythonExceptionSummary(MESSAGE_MENTIONS_FILE_LINE),
      'ValueError: parse error in:\n  File "data.txt", line 99, here',
    );
  });

  it('keeps a message continuation that is a Rich `path:line in name` location', () => {
    // The Rich-shape sibling of RT-6: the in-message `other.py:10 in foo` must not
    // reset the anchor and drop the exception type and first message line.
    assert.equal(
      extractPythonExceptionSummary(MESSAGE_MENTIONS_RICH_FRAME),
      'ValueError: bad reference at\nother.py:10 in foo',
    );
  });

  it('strips the `[NOTE] ` prefix from a multi-line note without leaking it', () => {
    // A note whose text spans multiple lines carries the `[NOTE] ` prefix only on
    // its first line; the prefix must be removed and never appear in the output,
    // and the continuation line must stay grouped with the note.
    assert.equal(
      extractPythonExceptionSummary(MULTILINE_NOTE),
      "KeyError: 'x'\n" +
        'Error processing element <pl-thing>\n' +
        '  while rendering panel "question"',
    );
    assert.notInclude(extractPythonExceptionSummary(MULTILINE_NOTE) ?? '', '[NOTE]');
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

  it('surfaces the full multi-line exception message', () => {
    const err = Object.assign(
      new Error('CodeCallerNative child process exited unexpectedly, code = 1, signal = null'),
      { data: { outputBoth: MULTILINE_TRACEBACK } },
    );
    const message = getInstructorErrorMessage(err);
    assert.equal(
      message,
      "ValueError: Invalid configuration for 'pl-matrix-component-input':\n" +
        "  - 'rows' must be a positive integer\n" +
        "  - 'columns' must be a positive integer",
    );
    // The exception type and the first message line must not be dropped.
    assert.include(message, 'ValueError:');
    assert.include(message, "rows' must be a positive integer");
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
