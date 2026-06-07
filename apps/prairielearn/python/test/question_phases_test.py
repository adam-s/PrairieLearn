"""Tests for unknown-element handling in the question processing phases.

Regression coverage for: "Throw an error on unrecognized pl-* elements"
(https://github.com/PrairieLearn/PrairieLearn/issues/2279).

An unrecognized `pl-*` tag must raise during the `render` phase instead of
silently passing through, while leaving plain HTML, non-`pl-` tags, and the
"child" `pl-*` tags consumed by parent elements (visited by the non-render
phases) untouched.
"""

from typing import Any

import pytest
from prairielearn.internal.question_phases import RenderContext, process


def _context(html: str) -> RenderContext:
    # No elements are registered, so any `pl-*` tag is "unknown".
    return {
        "html": html,
        "elements": {},
        "element_extensions": {},
        "course_path": "/tmp",
    }


def _data() -> dict[str, Any]:
    return {
        "params": {},
        "correct_answers": {},
        "submitted_answers": {},
        "format_errors": {},
        "partial_scores": {},
        "score": 0,
        "feedback": {},
        "editable": True,
        "panel": "question",
        "extensions": {},
        "num_valid_submissions": 1,
        "manual_grading": False,
        "answers_names": {},
    }


def test_render_raises_on_unknown_pl_element() -> None:
    with pytest.raises(ValueError, match="Unknown element: pl-does-not-exist"):
        process("render", _data(), _context("<pl-does-not-exist></pl-does-not-exist>"))


def test_render_raises_on_unknown_pl_element_nested_in_passthrough() -> None:
    # A genuinely-unknown `pl-*` nested inside a passthrough parent is
    # re-traversed at render and must still be flagged.
    html = "<div><span></span><pl-bogus></pl-bogus></div>"
    with pytest.raises(ValueError, match="Unknown element: pl-bogus"):
        process("render", _data(), _context(html))


def test_render_allows_plain_html() -> None:
    # Plain (non-`pl-`) tags are never flagged.
    out, _ = process("render", _data(), _context("<div><p>hello</p></div>"))
    assert out is not None
    assert "hello" in out


def test_render_allows_non_pl_custom_element() -> None:
    # A custom element not prefixed `pl-` (e.g. a course element) is left alone.
    out, _ = process("render", _data(), _context("<course-element></course-element>"))
    assert out is not None
    assert "course-element" in out


@pytest.mark.parametrize("phase", ["prepare", "parse", "grade"])
def test_non_render_phases_ignore_unknown_pl_elements(phase: str) -> None:
    # Non-render phases use `traverse_and_execute`, which walks every descendant
    # node -- including "child" `pl-*` tags such as `pl-answer` that a parent
    # element consumes itself at render time. Flagging those would break valid
    # questions, so these phases must not raise.
    html = "<pl-checkbox><pl-answer>a</pl-answer></pl-checkbox>"
    # Should not raise.
    process(phase, _data(), _context(html))
