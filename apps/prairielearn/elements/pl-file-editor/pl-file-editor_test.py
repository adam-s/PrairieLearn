import base64
import importlib
from pathlib import Path
from typing import Any

import pytest

file_editor = importlib.import_module("pl-file-editor")


def make_question_data(
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
    }


def _render_after_parse(element_html: str, data: dict[str, Any]) -> str:
    file_editor.parse(element_html, data)
    return file_editor.render(element_html, data)


def test_invalid_submission_shows_badge_beside_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An invalid (empty, no allow-blank) submission shows the "Invalid" badge in the
    question panel beside the input, not only in the submission panel (issue #5902)."""
    monkeypatch.chdir(Path(__file__).parent)
    element_html = '<pl-file-editor file-name="ans.py"></pl-file-editor>'
    answer_name = file_editor.get_answer_name("ans.py")
    data = make_question_data(submitted_answers={answer_name: ""})

    rendered = _render_after_parse(element_html, data)

    # The format error is recorded both for the submission panel ("_files") and the
    # element itself (answer_name), so it can render beside the input.
    assert "_files" in data["format_errors"]
    assert answer_name in data["format_errors"]
    # The "Invalid" badge with its Format-error popover is present in the question panel.
    assert "badge text-bg-danger" in rendered
    assert "Invalid" in rendered
    assert "Format error" in rendered


def test_valid_submission_has_no_badge(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(Path(__file__).parent)
    element_html = '<pl-file-editor file-name="ans.py"></pl-file-editor>'
    answer_name = file_editor.get_answer_name("ans.py")
    contents = base64.b64encode(b"print('hi')").decode()
    data = make_question_data(submitted_answers={answer_name: contents})

    rendered = _render_after_parse(element_html, data)

    assert data["format_errors"] == {}
    assert "badge text-bg-danger" not in rendered


def test_allow_blank_empty_has_no_badge(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(Path(__file__).parent)
    element_html = (
        '<pl-file-editor file-name="ans.py" allow-blank="true"></pl-file-editor>'
    )
    answer_name = file_editor.get_answer_name("ans.py")
    data = make_question_data(submitted_answers={answer_name: ""})

    rendered = _render_after_parse(element_html, data)

    assert data["format_errors"] == {}
    assert "badge text-bg-danger" not in rendered
