import stripAnsi from 'strip-ansi';

// Prefix that `BaseException.add_note(...)` notes are rendered with in the
// worker traceback (see the excepthook in `python/prairielearn/internal/traceback.py`).
const NOTE_PREFIX = '[NOTE] ';

// A traceback frame *header*: the line that names a stack frame, immediately
// above that frame's source-context lines. Two shapes occur depending on the
// formatter:
//   - CPython's default:  `  File "server.py", line 3, in generate`
//   - the worker's Rich excepthook:  `questions/q/server.py:3 in generate`
// The trailing `, line N` / `:N in name` (with a space-free path before the `:`)
// is what distinguishes a real frame header from an ordinary message line that
// merely starts with `File "` or merely mentions a `path:line`.
const FRAME_HEADER = /^File ".*", line \d+|^\S+:\d+ in \S/;

/**
 * Pull the human-readable summary out of a Python worker traceback.
 *
 * When code in a question (`server.py`, an element, etc.) raises, the worker
 * prints a full traceback to stderr and exits, so the only error the Node side
 * sees is a generic "child process exited unexpectedly" message. The actual
 * cause — e.g. `KeyError: 'answers-name'` or `Exception: Required attribute
 * 'xyz' missing` — lives at the end of that captured traceback (`outputBoth`).
 *
 * Python always ends a traceback with the exception summary
 * (`ExceptionType: message`, which may span MULTIPLE lines when the message
 * itself contains newlines — common for assertions and config/format validation
 * errors), optionally followed by `[NOTE] ...` lines for any notes attached via
 * `add_note(...)` (the worker uses these to record which element was being
 * processed). We return the WHOLE summary block — type + every message line —
 * with any notes appended as extra context, and leave the full traceback for the
 * issue's console-log panel.
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

  // `i` now points at the LAST line of the exception-summary block. That block is
  // `ExceptionType: <message>` plus any continuation lines of a multi-line message
  // — everything between the traceback's frame region and the notes. We capture
  // the whole block, not just its final line, so the exception type and the full
  // message survive in the headline (the full traceback stays in the console-log
  // panel).
  if (i < 0) return null;
  const end = i;

  // Anchor on the LAST frame header. A traceback's frame region is a run of
  // `<frame header>` + source-context lines; the exception summary begins on the
  // first real line after the final frame's source context. The frame header is
  // the one piece of scaffolding that can't be confused with a message line, so
  // we locate the last one, then skip its trailing source-context lines.
  let header = -1;
  for (let j = end; j >= 0; j--) {
    if (FRAME_HEADER.test(lines[j].trimStart())) {
      header = j;
      break;
    }
  }

  // Source-context lines are the only thing between the last header and the
  // summary. In both formats they begin with whitespace or Rich's `❱`/`>` pointer
  // (classic: `    <source>`; Rich: `  23 <source>` / `❱ 24 <source>`). The
  // exception summary's first line starts with the type name, never whitespace,
  // so the block begins at the first non-blank, non-indented line after the
  // header. (When there's no frame header at all — e.g. output that is only the
  // summary — scan from the top.)
  let start = end + 1;
  for (let j = header + 1; j <= end; j++) {
    if (lines[j] === '' || /^[\s❱>]/.test(lines[j])) continue;
    start = j;
    break;
  }

  // Nothing but scaffolding after the last header → no summary recovered.
  if (start > end) return null;

  const summary = lines.slice(start, end + 1);
  return [...summary, ...notes].join('\n');
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
