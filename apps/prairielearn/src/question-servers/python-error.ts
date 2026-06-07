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
// merely starts with `File "` or merely mentions a `path:line`. This shape is
// *necessary* but not *sufficient*: a CPython-style `File "data.txt", line 99`
// (or a Rich-style `other.py:10 in foo`) can legitimately appear INSIDE an
// exception message, so a match is only treated as a frame when it falls within
// a traceback's frame region (see `extractPythonExceptionSummary`).
const FRAME_HEADER = /^File ".*", line \d+|^\S+:\d+ in \S/;

// A frame's source-context line: indented source (`    <source>`) or Rich's
// line-number gutter / pointer forms (`  23 <source>`, `❱ 24 <source>`,
// `> 24 <source>`). The exception summary's first line starts with the type
// name, never with whitespace or a pointer, so this never matches it.
const SOURCE_CONTEXT = /^[\s❱>]/;

// The banner / connector lines that *introduce* a traceback's frame region. Only
// after one of these (and before the exception summary's type line) do we treat a
// `FRAME_HEADER`-shaped line as an actual frame. Chained exceptions repeat the
// banner after a connector, so both reopen a frame region.
const TRACEBACK_BANNER = /^Traceback \(most recent call last\)/;
const CHAIN_CONNECTOR =
  /^(During handling of the above exception|The above exception was the direct cause)/;

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

  const skipBlanksBack = (idx: number) => {
    while (idx >= 0 && lines[idx] === '') idx--;
    return idx;
  };

  // Notes render after the exception summary; collect them as extra context. A
  // single note may itself be MULTI-LINE — the worker prints it as
  // `Text.assemble(("[NOTE] ", …), note)`, so only the note's FIRST line carries
  // the `[NOTE] ` prefix and its continuation lines do not. We anchor on the
  // first `[NOTE] ` line and absorb everything below it as note text (stripping
  // the prefix where present), so the literal `[NOTE] ` scaffolding never leaks
  // into the headline and a note's continuation lines aren't mistaken for the
  // exception message.
  const lastIdx = skipBlanksBack(lines.length - 1);
  let firstNote = -1;
  for (let j = 0; j <= lastIdx; j++) {
    if (lines[j].startsWith(NOTE_PREFIX)) {
      firstNote = j;
      break;
    }
  }
  const notes: string[] = [];
  let end = lastIdx;
  if (firstNote !== -1) {
    for (let j = firstNote; j <= lastIdx; j++) {
      if (lines[j].startsWith(NOTE_PREFIX)) notes.push(lines[j].slice(NOTE_PREFIX.length));
      else if (lines[j] !== '') notes.push(lines[j]);
    }
    end = skipBlanksBack(firstNote - 1);
  }

  // `end` now points at the LAST line of the exception-summary block — everything
  // between the traceback's frame region and the notes. The block is
  // `ExceptionType: <message>` plus any continuation lines of a multi-line message;
  // we capture the whole block, not just its final line, so the exception type and
  // the full message survive in the headline (the full traceback stays in the
  // console-log panel). With no summary block, fall back to any notes alone.
  if (end < 0) return notes.length ? notes.join('\n') : null;

  // Anchor on the end of the LAST traceback frame region. A frame region is a run
  // of `<frame header>` + that frame's source-context lines, introduced by a
  // `Traceback (most recent call last)` banner (or a chained-exception
  // connector). The exception summary begins on the first real line after the
  // final region. Crucially, a `FRAME_HEADER`-shaped line is treated as a frame
  // ONLY while we're inside such a region (`expectingFrames`): once the summary's
  // type line closes the region, a `File "...", line N` (or `path:N in fn`) that
  // appears inside the exception MESSAGE no longer resets the anchor — that
  // CPython-style location in a config/file-load message is exactly what used to
  // be misread as "the last frame," leaving nothing after it and returning null.
  let frameRegionEnd = -1;
  let expectingFrames = false;
  for (let j = 0; j <= end; j++) {
    const stripped = lines[j].trimStart();
    if (TRACEBACK_BANNER.test(stripped) || CHAIN_CONNECTOR.test(stripped)) {
      expectingFrames = true;
    } else if (expectingFrames && FRAME_HEADER.test(stripped)) {
      frameRegionEnd = j;
    } else if (expectingFrames && (lines[j] === '' || SOURCE_CONTEXT.test(lines[j]))) {
      if (lines[j] !== '') frameRegionEnd = j;
    } else {
      // A non-frame, non-source line inside a region is the summary's type line:
      // the message begins here, so stop treating later frame-shaped lines as
      // frames.
      expectingFrames = false;
    }
  }

  // The summary begins at the first non-blank, non-source line after the last
  // frame region. (When there's no frame region at all — e.g. output that is only
  // the summary — `frameRegionEnd` is -1 and we scan from the top.)
  let start = frameRegionEnd + 1;
  while (start <= end && (lines[start] === '' || SOURCE_CONTEXT.test(lines[start]))) start++;

  // Nothing but scaffolding after the last frame region → no summary recovered.
  if (start > end) return notes.length ? notes.join('\n') : null;

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
