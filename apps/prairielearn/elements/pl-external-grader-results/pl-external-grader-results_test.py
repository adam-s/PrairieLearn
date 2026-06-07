"""Regression test for issue PrairieLearn/PrairieLearn#2421.

A long, unbreakable test name (e.g. a random token or a URL) in an external-grader
test-result card title used to push past the card's right border, because the title is a
Bootstrap flex item whose default ``min-width: auto`` stops it from shrinking below the
word's intrinsic width, so the word never wraps.

The fix marks the test-name ``<span>`` with the ``test-name`` class and scopes
``min-width: 0`` (plus ``overflow-wrap: break-word``) to it and the surrounding
``.card-title`` in the element stylesheet, letting the long word wrap inside the card.

These tests assert the rendered markup carries that wrap hook on the test name. (The pixel
layout itself is verified by before/after screenshots in the journey; a Python test can only
assert the markup.)
"""

import importlib
from pathlib import Path
from typing import Any

import lxml.html
import pytest

external_grader_results = importlib.import_module("pl-external-grader-results")

LONG_NAME = "Unit Test: / " + "mKtsiDRJypUieHIkvJaMFkwa" * 4 + " -> True"
SHORT_NAME = "Random Test: / Your code can pass random tests!"


def make_submission_data(test_names: list[str]) -> dict[str, Any]:
    """Feedback shaped like an external grader's results, with the given test names."""
    return {
        "panel": "submission",
        "feedback": {
            "succeeded": True,
            "results": {
                "gradable": True,
                "score": 1.0,
                "tests": [
                    {"name": name, "points": 1, "max_points": 1} for name in test_names
                ],
            },
        },
        "format_errors": {},
    }


def render_results(
    test_names: list[str], monkeypatch: pytest.MonkeyPatch
) -> lxml.html.HtmlElement:
    # render() opens the mustache template by a relative path, so run from the element dir.
    monkeypatch.chdir(Path(__file__).parent)
    html = external_grader_results.render(
        "<pl-external-grader-results></pl-external-grader-results>",
        make_submission_data(test_names),
    )
    return lxml.html.fromstring(html)


def test_long_test_name_can_wrap(monkeypatch: pytest.MonkeyPatch) -> None:
    """The long test name renders inside a wrap-enabled span so it cannot overflow the card."""
    doc = render_results([LONG_NAME], monkeypatch)

    # The fix puts the name in `.card-title .test-name`; the scoped CSS gives that element
    # min-width: 0 + overflow-wrap so the unbreakable word wraps instead of overflowing.
    names = doc.cssselect(".card-title .test-name")
    assert len(names) == 1, "the test name must render in a `.test-name` span"
    assert names[0].text_content().strip() == LONG_NAME


def test_every_test_name_uses_wrap_hook(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both short and long names route through the same wrap-enabled span (no regression)."""
    doc = render_results([SHORT_NAME, LONG_NAME], monkeypatch)

    names = [
        el.text_content().strip() for el in doc.cssselect(".card-title .test-name")
    ]
    assert names == [SHORT_NAME, LONG_NAME]
