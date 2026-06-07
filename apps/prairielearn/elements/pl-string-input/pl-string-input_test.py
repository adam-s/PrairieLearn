import importlib
from pathlib import Path
from typing import Any

import pytest

string_input = importlib.import_module("pl-string-input")


def build_element_html(*attributes: str, answers_name: str = "test") -> str:
    return "\n".join([
        "<pl-string-input",
        f'    answers-name="{answers_name}"',
        *[f"    {attribute}" for attribute in attributes],
        "></pl-string-input>",
    ])


def make_question_data(*, panel: str = "question", editable: bool = True) -> dict[str, Any]:
    return {
        "submitted_answers": {},
        "raw_submitted_answers": {},
        "correct_answers": {},
        "answers_names": {},
        "format_errors": {},
        "partial_scores": {},
        "score": 0,
        "feedback": {},
        "variant_seed": "1",
        "options": {},
        "panel": panel,
        "editable": editable,
        "extensions": {},
        "num_valid_submissions": 0,
        "manual_grading": False,
    }


def test_label_span_has_targetable_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """The label is rendered into a span with an ``id`` ending in ``-label``.

    This is the hook the CSS uses to preserve whitespace in math labels
    (issue #4371). If the markup changes, the CSS fix silently stops applying.
    """
    monkeypatch.chdir(Path(__file__).parent)
    element_html = build_element_html('label="$L$ is "')
    data = make_question_data()

    string_input.prepare(element_html, data)
    rendered = string_input.render(element_html, data)

    assert 'class="input-group-text"' in rendered
    assert 'id="pl-string-input-' in rendered and '-label"' in rendered


def test_label_css_preserves_whitespace() -> None:
    """The element CSS preserves literal spaces in (math) labels (issue #4371).

    Bootstrap's ``.input-group-text`` sets ``white-space: nowrap``; combined with
    MathJax's block-level ``mjx-container`` this collapses the literal space in
    ``label="$L$ is "`` so it renders as "Lis". A ``white-space: pre-wrap`` rule
    scoped to the label span restores it. Lock that rule in so it can't regress.
    """
    css = (Path(__file__).parent / "pl-string-input.css").read_text()
    normalized = " ".join(css.split())
    assert ".pl-string-input .input-group-text[id$='-label']" in normalized
    assert "white-space: pre-wrap" in normalized
