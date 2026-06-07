import stripAnsi from 'strip-ansi';

// Prefix that `BaseException.add_note(...)` notes are rendered with in the
// worker traceback (see the excepthook in `python/prairielearn/internal/traceback.py`).
const NOTE_PREFIX = '[NOTE] ';

/**
 * Pull the human-readable summary out of a Python worker traceback.
 *
 * When code in a question (`server.py`, an element, etc.) raises, the worker
 * prints a full traceback to stderr and exits, so the only error the Node side
 * sees is a generic "child process exited unexpectedly" message. The actual
 * cause — e.g. `KeyError: 'answers-name'` or `Exception: Required attribute
 * 'xyz' missing` — lives at the end of that captured traceback (`outputBoth`).
 *
 * Python always ends a traceback with the exception summary line
 * (`ExceptionType: message`), optionally followed by `[NOTE] ...` lines for any
 * notes attached via `add_note(...)` (the worker uses these to record which
 * element was being processed). We return that summary line, with any notes
 * appended as extra context, and leave the full traceback for the issue's
 * console-log panel.
 *
 * Returns `null` when no exception summary can be recovered (e.g. the output is
 * empty or contains only traceback scaffolding), so callers can fall back to
 * their existing message.
 */
export function extractPythonExceptionSummary(outputBoth: string): string | null {
  const lines = stripAnsi(outputBoth)
    .split('\n')
    .map((line) => line.trimEnd());

  // Notes render after the exception summary; collect them as extra context.
  const notes: string[] = [];
  let i = lines.length - 1;

  const skipBlanks = () => {
    while (i >= 0 && lines[i] === '') i--;
  };

  skipBlanks();
  while (i >= 0 && lines[i].startsWith(NOTE_PREFIX)) {
    notes.unshift(lines[i].slice(NOTE_PREFIX.length));
    i--;
    skipBlanks();
  }

  if (i < 0) return null;
  const summary = lines[i];

  // Reject obvious traceback scaffolding: if the last meaningful line is a frame
  // header (`  File "...", line N, in fn`) or the traceback banner, we never
  // reached an exception summary. Frame headers are indented, so trim first.
  const trimmed = summary.trimStart();
  if (trimmed.startsWith('File "') || trimmed.startsWith('Traceback ')) return null;

  return notes.length > 0 ? [summary, ...notes].join('\n') : summary;
}

/**
 * Build the instructor-facing message for an error thrown while executing
 * question code. Prefers the friendly Python exception summary (extracted from
 * the captured traceback) over the raw, technical error string.
 *
 * @param err The error caught from the code caller. Its `data.outputBoth` holds
 *   the captured Python stdout/stderr when the failure came from question code.
 * @param fallback The message to use when no Python exception summary is
 *   available (defaults to `err.message`, preserving prior behavior).
 */
export function getInstructorErrorMessage(
  err: { message: string; data?: { outputBoth?: string } | null },
  fallback: string = err.message,
): string {
  const outputBoth = err.data?.outputBoth;
  const summary = outputBoth != null ? extractPythonExceptionSummary(outputBoth) : null;
  return summary ?? fallback;
}
