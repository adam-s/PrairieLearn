import base64
import importlib
import os
from typing import Any

file_editor = importlib.import_module("pl-file-editor")

ELEMENT_DIR = os.path.dirname(os.path.abspath(__file__))


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("utf-8")


def _data(panel: str, files: list[dict[str, Any]], *, ai_grading: bool = False) -> Any:
    return {
        "panel": panel,
        "submitted_answers": {"_files": files},
        "options": {"submission_files_url": "/sub/files"},
        "ai_grading": ai_grading,
        "editable": False,
        "format_errors": {},
    }


def _render(element_html: str, data: Any) -> str:
    # render() opens its mustache templates by relative path, so it must run with
    # the element directory as the working directory (pytest's cwd is the repo root).
    prev = os.getcwd()
    os.chdir(ELEMENT_DIR)
    try:
        return file_editor.render(element_html, data)
    finally:
        os.chdir(prev)


def test_submission_panel_shows_submitted_file() -> None:
    """The submission panel shows the saved file's name and contents (issue 9806).

    Before the fix, pl-file-editor rendered nothing for the submission panel, so the
    "Submitted answer" box was blank even though the file was saved.
    """
    html = _render(
        '<pl-file-editor file-name="answer.py"></pl-file-editor>',
        _data(
            "submission",
            [{"name": "answer.py", "contents": _b64("def f(n):\n    return n")}],
        ),
    )
    assert html.strip() != ""
    assert "answer.py" in html
    assert "def f(n):" in html


def test_submission_panel_escapes_file_contents() -> None:
    html = _render(
        '<pl-file-editor file-name="x.py"></pl-file-editor>',
        _data(
            "submission",
            [{"name": "x.py", "contents": _b64("<script>alert(1)</script>")}],
        ),
    )
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


def test_submission_panel_only_shows_own_file() -> None:
    files = [
        {"name": "a.py", "contents": _b64("AAA")},
        {"name": "b.py", "contents": _b64("BBB")},
    ]
    html_a = _render(
        '<pl-file-editor file-name="a.py"></pl-file-editor>', _data("submission", files)
    )
    assert "AAA" in html_a
    assert "BBB" not in html_a


def test_submission_panel_no_file_submitted() -> None:
    html = _render(
        '<pl-file-editor file-name="missing.py"></pl-file-editor>',
        _data("submission", [{"name": "other.py", "contents": _b64("x")}]),
    )
    assert "No file was submitted" in html
    assert "other.py" not in html


def test_submission_panel_opt_out() -> None:
    """show-file-in-submission="false" suppresses the default display (back-compat)."""
    html = _render(
        '<pl-file-editor file-name="answer.py" show-file-in-submission="false"></pl-file-editor>',
        _data("submission", [{"name": "answer.py", "contents": _b64("hidden")}]),
    )
    assert html.strip() == ""


def test_submission_panel_skipped_for_ai_grading() -> None:
    html = _render(
        '<pl-file-editor file-name="answer.py"></pl-file-editor>',
        _data(
            "submission",
            [{"name": "answer.py", "contents": _b64("x")}],
            ai_grading=True,
        ),
    )
    assert html.strip() == ""


def test_answer_panel_renders_nothing() -> None:
    html = _render(
        '<pl-file-editor file-name="answer.py"></pl-file-editor>',
        _data("answer", [{"name": "answer.py", "contents": _b64("x")}]),
    )
    assert html.strip() == ""


def test_question_panel_still_renders_editor() -> None:
    html = _render(
        '<pl-file-editor file-name="answer.py">def f(): pass</pl-file-editor>',
        _data("question", []),
    )
    assert "file-editor-" in html
