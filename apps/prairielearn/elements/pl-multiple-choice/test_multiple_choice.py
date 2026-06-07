import importlib
from typing import Any

import pytest

pl_multiple_choice = importlib.import_module("pl-multiple-choice")

prepare_answers_to_display = pl_multiple_choice.prepare_answers_to_display
AotaNotaType = pl_multiple_choice.AotaNotaType
OrderType = pl_multiple_choice.OrderType
DisplayType = pl_multiple_choice.DisplayType
AnswerTuple = pl_multiple_choice.AnswerTuple


def mc_html(
    extra_attrs: str = "",
    answers: str = "<pl-answer>A</pl-answer><pl-answer>B</pl-answer>",
    *,
    builtin_grading: bool = False,
) -> str:
    bg = "" if builtin_grading else ' builtin-grading="false"'
    extra = f" {extra_attrs}" if extra_attrs else ""
    return (
        f'<pl-multiple-choice answers-name="survey" order="fixed"{bg}{extra}>'
        f"{answers}"
        "</pl-multiple-choice>"
    )


FOUR_INCORRECT = (
    "<pl-answer>A</pl-answer><pl-answer>B</pl-answer>"
    "<pl-answer>C</pl-answer><pl-answer>D</pl-answer>"
)
NO_BUILTIN_GRADING_HTML = mc_html(answers=FOUR_INCORRECT)
DEFAULT_GRADING_NO_CORRECT_HTML = mc_html(answers=FOUR_INCORRECT, builtin_grading=True)


def _make_question_data() -> dict[str, Any]:
    return {
        "params": {},
        "correct_answers": {},
        "submitted_answers": {},
        "format_errors": {},
        "partial_scores": {},
        "feedback": {},
        "raw_submitted_answers": {},
        "options": {"question_path": "."},
    }


def make_answers(
    correct: list[str], incorrect: list[str]
) -> tuple[list[Any], list[Any]]:
    correct_answers = [
        AnswerTuple(i, True, t, None, None) for i, t in enumerate(correct)
    ]
    offset = len(correct)
    incorrect_answers = [
        AnswerTuple(offset + i, False, t, None, None) for i, t in enumerate(incorrect)
    ]
    return correct_answers, incorrect_answers


def _prepare_with_defaults(
    correct: list[str],
    incorrect: list[str],
    *,
    builtin_grading: bool = True,
    number_answers: int | None = None,
) -> list[Any]:
    correct_answers, incorrect_answers = make_answers(correct, incorrect)
    return prepare_answers_to_display(
        correct_answers,
        incorrect_answers,
        number_answers=number_answers,
        aota=AotaNotaType.FALSE,
        nota=AotaNotaType.FALSE,
        aota_feedback=None,
        nota_feedback=None,
        order_type=OrderType.FIXED,
        display_type=DisplayType.BLOCK,
        builtin_grading=builtin_grading,
    )


@pytest.mark.parametrize("builtin_grading", [True, False])
def test_zero_answers_raises(builtin_grading: bool) -> None:
    with pytest.raises(ValueError, match="at least 1 answer choice"):
        _prepare_with_defaults([], [], builtin_grading=builtin_grading)


def test_no_correct_answers_raises_with_builtin_grading() -> None:
    with pytest.raises(ValueError, match="at least 1 correct answer"):
        _prepare_with_defaults([], ["A", "B", "C"])


def test_no_correct_answers_allowed_without_builtin_grading() -> None:
    result = _prepare_with_defaults([], ["A", "B", "C"], builtin_grading=False)
    assert len(result) == 3
    assert all(not a.correct for a in result)


def test_builtin_grading_false_with_correct_answers_still_works() -> None:
    result = _prepare_with_defaults(["A"], ["B", "C"], builtin_grading=False)
    assert len(result) == 3
    assert sum(1 for a in result if a.correct) == 1


def test_number_answers_exceeding_total_with_no_correct() -> None:
    result = _prepare_with_defaults(
        [], ["A", "B", "C"], builtin_grading=False, number_answers=4
    )
    assert len(result) == 3


def test_prepare_no_correct_answers_from_html() -> None:
    data = _make_question_data()
    pl_multiple_choice.prepare(NO_BUILTIN_GRADING_HTML, data)

    assert len(data["params"]["survey"]) == 4
    assert data["correct_answers"]["survey"] is None


def test_prepare_no_correct_answers_default_raises() -> None:
    data = _make_question_data()
    with pytest.raises(ValueError, match="at least 1 correct answer"):
        pl_multiple_choice.prepare(DEFAULT_GRADING_NO_CORRECT_HTML, data)


@pytest.mark.parametrize(
    ("html", "match"),
    [
        (mc_html('weight="2"'), r"weight.*should not be set"),
        (
            mc_html(
                'all-of-the-above="correct"',
                '<pl-answer correct="true">A</pl-answer>'
                '<pl-answer correct="true">B</pl-answer>',
            ),
            r"all-of-the-above.*true or false",
        ),
        (
            mc_html(
                'none-of-the-above="correct"',
                '<pl-answer correct="true">A</pl-answer><pl-answer>B</pl-answer>',
            ),
            r"none-of-the-above.*true or false",
        ),
        (mc_html('hide-score-badge="true"'), r"hide-score-badge.*should not be set"),
        (
            mc_html(
                answers='<pl-answer score="0.5">A</pl-answer><pl-answer>B</pl-answer>'
            ),
            r"score.*should not be set",
        ),
        (
            mc_html(
                answers='<pl-answer feedback="Nice try">A</pl-answer><pl-answer>B</pl-answer>'
            ),
            r"feedback.*should not be set",
        ),
    ],
    ids=[
        "weight",
        "aota_correct",
        "nota_correct",
        "hide_score_badge",
        "score_on_answer",
        "feedback_on_answer",
    ],
)
def test_prepare_rejects_with_no_builtin_grading(html: str, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        pl_multiple_choice.prepare(html, _make_question_data())


@pytest.mark.parametrize(
    "attr",
    ['all-of-the-above="true"', 'none-of-the-above="true"'],
    ids=["aota_boolean", "nota_boolean"],
)
def test_prepare_allows_aota_nota_boolean_with_no_builtin_grading(attr: str) -> None:
    data = _make_question_data()
    pl_multiple_choice.prepare(mc_html(attr), data)
    assert len(data["params"]["survey"]) == 3


def test_grade_skipped_when_builtin_grading_false() -> None:
    data = _make_question_data()
    pl_multiple_choice.prepare(NO_BUILTIN_GRADING_HTML, data)
    data["submitted_answers"]["survey"] = "a"

    pl_multiple_choice.grade(NO_BUILTIN_GRADING_HTML, data)

    assert "survey" not in data["partial_scores"]


@pytest.mark.parametrize(
    "html",
    [
        NO_BUILTIN_GRADING_HTML,
        mc_html(
            answers='<pl-answer correct="true">Right</pl-answer><pl-answer>Wrong</pl-answer>'
        ),
    ],
    ids=["no_correct", "with_correct"],
)
def test_render_answer_panel_empty_when_builtin_grading_false(html: str) -> None:
    data = _make_question_data()
    pl_multiple_choice.prepare(html, data)
    data["panel"] = "answer"
    data["editable"] = False

    assert pl_multiple_choice.render(html, data) == ""


def test_test_submits_valid_answer_when_builtin_grading_false() -> None:
    data = _make_question_data()
    pl_multiple_choice.prepare(NO_BUILTIN_GRADING_HTML, data)
    data["test_type"] = "correct"

    pl_multiple_choice.test(NO_BUILTIN_GRADING_HTML, data)

    assert "survey" in data["raw_submitted_answers"]
    assert "survey" not in data["partial_scores"]


def test_test_invalid_submission_when_builtin_grading_false() -> None:
    data = _make_question_data()
    pl_multiple_choice.prepare(NO_BUILTIN_GRADING_HTML, data)
    data["test_type"] = "invalid"

    pl_multiple_choice.test(NO_BUILTIN_GRADING_HTML, data)

    assert data["raw_submitted_answers"]["survey"] == "0"
    assert "survey" in data["format_errors"]


# --- Inline display must not emit block-level wrappers (issue #10538) ----------
#
# A block-level <div> inside an author's <p> triggers the HTML parser's "tag
# omission" rule, prematurely closing the <p> and breaking the inline flow when
# `display="inline"` is used next to text. The inline variant must therefore render
# only inline (<span>) wrappers; the block variant keeps its <div> wrappers.
# https://github.com/PrairieLearn/PrairieLearn/issues/10538

import os  # noqa: E402
import pathlib  # noqa: E402

import lxml.html  # noqa: E402

# `render()` opens the mustache template by a path relative to the element
# directory (matching how PrairieLearn runs element code with that dir as cwd).
_ELEMENT_DIR = pathlib.Path(__file__).resolve().parent


@pytest.fixture
def _in_element_dir() -> Any:
    prev = os.getcwd()
    os.chdir(_ELEMENT_DIR)
    try:
        yield
    finally:
        os.chdir(prev)


def _render_panel(html: str, panel: str, *, submitted_key: str | None = None) -> str:
    data = _make_question_data()
    pl_multiple_choice.prepare(html, data)
    data["panel"] = panel
    data["editable"] = True
    if submitted_key is not None:
        data["submitted_answers"]["survey"] = submitted_key
        if panel == "submission":
            pl_multiple_choice.parse(html, data)
    return pl_multiple_choice.render(html, data)


def _has_div_descendant(html: str) -> bool:
    # Parse the fragment the same way a browser would and ask whether any <div>
    # appears anywhere in the rendered subtree.
    root = lxml.html.fragment_fromstring(html, create_parent="div")
    return any(child.tag == "div" for child in root.iter() if child is not root)


INLINE_MC = mc_html(
    'display="inline"',
    '<pl-answer correct="true">A</pl-answer><pl-answer>B</pl-answer>',
    builtin_grading=True,
)
BLOCK_MC = mc_html(
    'display="block"',
    '<pl-answer correct="true">A</pl-answer><pl-answer>B</pl-answer>',
    builtin_grading=True,
)


@pytest.mark.usefixtures("_in_element_dir")
def test_inline_question_panel_has_no_block_wrappers() -> None:
    out = _render_panel(INLINE_MC, "question")
    assert not _has_div_descendant(out), (
        "inline pl-multiple-choice must not render <div> wrappers "
        "(they close the surrounding <p> via HTML tag omission)"
    )
    # The choices are still rendered, just as inline <span> form-checks.
    assert "form-check-inline" in out


@pytest.mark.usefixtures("_in_element_dir")
def test_inline_submission_panel_has_no_block_wrappers() -> None:
    out = _render_panel(INLINE_MC, "submission", submitted_key="a")
    assert not _has_div_descendant(out), (
        "inline pl-multiple-choice submission must not render <div> wrappers"
    )


@pytest.mark.usefixtures("_in_element_dir")
def test_block_question_panel_layout_unchanged() -> None:
    # Backwards compatibility: block display keeps its block-level flex layout
    # (driven by the `d-flex` class, which makes even a <span> a block-level flex
    # container). The wrapper tag changing div->span is invisible to the user.
    out = _render_panel(BLOCK_MC, "question")
    assert "form-check d-flex" in out, "block layout (d-flex) must be preserved"
    assert "form-check-inline" not in out, "block display must not use the inline layout"
    # Both choices are still rendered.
    assert out.count("form-check d-flex") == 2
