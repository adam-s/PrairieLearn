import base64
import importlib
from pathlib import Path
from typing import Any

import pytest

rich_text_editor = importlib.import_module("pl-rich-text-editor")


def _to_b64(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("utf-8")


def _make_question_data(
    *,
    submitted_answers: dict[str, Any] | None = None,
    panel: str = "question",
    editable: bool = True,
) -> dict[str, Any]:
    submitted_answers = submitted_answers or {}
    return {
        "params": {},
        "submitted_answers": submitted_answers,
        "raw_submitted_answers": dict(submitted_answers),
        "correct_answers": {},
        "answers_names": {},
        "format_errors": {},
        "partial_scores": {},
        "options": {},
        "panel": panel,
        "editable": editable,
        "ai_grading": False,
    }


def _render_after_parse(element_html: str, data: dict[str, Any]) -> str:
    rich_text_editor.parse(element_html, data)
    return rich_text_editor.render(element_html, data)


def test_invalid_submission_shows_badge_beside_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An invalid (empty, no allow-blank) submission shows the "Invalid" badge in the
    question panel beside the input, not only in the submission panel (issue #5902)."""
    monkeypatch.chdir(Path(__file__).parent)
    element_html = '<pl-rich-text-editor file-name="ans.html"></pl-rich-text-editor>'
    answer_name = rich_text_editor.get_answer_name("ans.html")
    data = _make_question_data(submitted_answers={answer_name: ""})

    rendered = _render_after_parse(element_html, data)

    assert "_files" in data["format_errors"]
    assert answer_name in data["format_errors"]
    assert "badge text-bg-danger" in rendered
    assert "Invalid" in rendered
    assert "Format error" in rendered


def test_valid_submission_has_no_badge(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(Path(__file__).parent)
    element_html = '<pl-rich-text-editor file-name="ans.html"></pl-rich-text-editor>'
    answer_name = rich_text_editor.get_answer_name("ans.html")
    data = _make_question_data(
        submitted_answers={answer_name: _to_b64("<p>hello world</p>")}
    )

    rendered = _render_after_parse(element_html, data)

    assert data["format_errors"] == {}
    assert "badge text-bg-danger" not in rendered


def test_allow_blank_empty_has_no_badge(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(Path(__file__).parent)
    element_html = (
        '<pl-rich-text-editor file-name="ans.html" allow-blank="true"></pl-rich-text-editor>'
    )
    answer_name = rich_text_editor.get_answer_name("ans.html")
    data = _make_question_data(submitted_answers={answer_name: ""})

    rendered = _render_after_parse(element_html, data)

    assert data["format_errors"] == {}
    assert "badge text-bg-danger" not in rendered


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        ("", 0),
        ("hello world", 2),
        ("<p>hello <strong>world</strong></p>", 2),
        ("hello  \t\tworld\n\nfrom\r\f\vpl", 4),
        ("hello&nbsp;&nbsp;world&#160;&#xA0;\u00a0from", 3),
        ("  hello world  ", 2),
        (
            "this is a longer plain text sentence that contains many words and should still be counted correctly",
            17,
        ),
        (
            "<div>this <em>longer</em> html string <span>contains several words</span> with <strong>mixed formatting</strong> across tags</div>",
            12,
        ),
        (
            "\n\n  leading spaces and lines\t\twith multiple\n\nseparators between words\r\f\vthroughout the content   ",
            12,
        ),
        (
            "<p>alpha&nbsp;&nbsp;&nbsp;beta&#160;gamma&#xA0;delta</p><p>epsilon \u00a0 zeta eta theta</p>",
            8,
        ),
        (
            "<section>start <b>with</b> many words and end with trailing spaces in a long example string for counting</section>    ",
            16,
        ),
    ],
)
def test_count_words_from_html_base64(html: str, expected: int) -> None:
    assert rich_text_editor.count_words_from_html_base64(_to_b64(html)) == expected
