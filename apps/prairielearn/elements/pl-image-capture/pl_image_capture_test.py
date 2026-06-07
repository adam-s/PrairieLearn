import base64
import importlib
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

image_capture = importlib.import_module("pl-image-capture")


def build_element_html(*attributes: str, file_name: str = "solution.jpg") -> str:
    return "\n".join([
        "<pl-image-capture",
        f'    file-name="{file_name}"',
        *[f"    {attribute}" for attribute in attributes],
        "></pl-image-capture>",
    ])


def make_question_data(
    *,
    submitted_answers: dict[str, Any] | None = None,
    raw_submitted_answers: dict[str, Any] | None = None,
    panel: str = "submission",
    editable: bool = False,
) -> dict[str, Any]:
    submitted_answers = submitted_answers or {}
    return {
        "submitted_answers": submitted_answers,
        "raw_submitted_answers": (
            raw_submitted_answers
            if raw_submitted_answers is not None
            else dict(submitted_answers)
        ),
        "correct_answers": {},
        "format_errors": {},
        "partial_scores": {},
        "panel": panel,
        "editable": editable,
        "ai_grading": False,
        "options": {},
    }


def make_jpeg_data_uri() -> str:
    img = Image.new("RGB", (2, 2), color="white")
    buffer = BytesIO()
    img.save(buffer, format="JPEG")
    b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


def test_required_blank_submission_shows_invalid_badge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression for PrairieLearn/PrairieLearn#14858: a required image left blank
    (allow-blank defaults to false) must surface a clear, per-element "Invalid"
    badge on the submission panel, like the other input elements.
    """
    monkeypatch.chdir(Path(__file__).parent)
    element_html = build_element_html()
    data = make_question_data()

    image_capture.parse(element_html, data)
    rendered = image_capture.render(element_html, data)

    assert "Invalid" in rendered
    assert "No image was submitted for solution.jpg." in rendered
    # The author asked for a red treatment: a red badge and a red card border.
    assert "badge text-bg-danger" in rendered
    assert "border-danger" in rendered


def test_valid_submission_has_no_invalid_badge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(Path(__file__).parent)
    element_html = build_element_html()
    answer_name = image_capture.get_answer_name("solution.jpg")
    data = make_question_data(
        submitted_answers={answer_name: make_jpeg_data_uri()},
    )

    image_capture.parse(element_html, data)
    assert answer_name not in data["format_errors"]

    rendered = image_capture.render(element_html, data)
    assert "Invalid" not in rendered
    assert "border-danger" not in rendered


def test_allow_blank_missing_image_has_no_invalid_badge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sibling check: with allow-blank="true", a missing image is valid, so no
    format error and no badge should appear."""
    monkeypatch.chdir(Path(__file__).parent)
    element_html = build_element_html('allow-blank="true"')
    data = make_question_data()

    image_capture.parse(element_html, data)
    assert data["format_errors"] == {}

    rendered = image_capture.render(element_html, data)
    assert "Invalid" not in rendered
    assert "border-danger" not in rendered


def test_question_panel_without_error_has_no_invalid_badge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(Path(__file__).parent)
    element_html = build_element_html()
    data = make_question_data(panel="question", editable=True)

    rendered = image_capture.render(element_html, data)
    assert "Invalid" not in rendered
    assert "border-danger" not in rendered
