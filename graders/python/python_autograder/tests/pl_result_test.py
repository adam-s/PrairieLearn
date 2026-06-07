# ruff: noqa: ANN201 ANN202
# pyright: reportUnknownParameterType=none, reportMissingParameterType=none
import json
import math
import os
import sys
import unittest
from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

import pl_unit_test
import pytest
from code_feedback import Feedback
from pl_execute import UserCodeFailedError
from pl_helpers import name, points
from pl_result import PLTestResult
from pl_unit_test import PLTestCase

"""
Regression tests for the Python autograder's handling of a student-code error.

Student code is executed once in PLTestCase.setUpClass (via execute_code). When
it raises a (non-syntax) exception, unittest fails the whole class and skips
every test method (TestSuite.run continues past tests when _classSetupFailed),
so the remaining tests would never get a result entry. That left the grading
panel showing only an error banner while the score denominator
(get_total_points) still counted all tests -> inconsistent score
(github.com/PrairieLearn/PrairieLearn/issues/5491). These tests assert that
every authored test still appears with 0 points and the score stays consistent.
"""


@pytest.fixture(autouse=True)
def grade_dirs(tmp_path: Path) -> Iterator[Path]:
    """Provide the dirs/files PLTestCase.setUpClass reads before execute_code
    (which we patch to raise). Feedback writes go to a real, writable dir."""
    merge = tmp_path / "run"
    merge.mkdir()
    (merge / "data.json").write_text(
        json.dumps({"params": {"names_for_user": [], "names_from_user": []}})
    )
    (merge / "user_code.py").write_text("raise RuntimeError('boom')\n")
    with patch.dict(os.environ, {"MERGE_DIR": str(merge), "FILENAMES_DIR": str(merge)}):
        yield merge


def _user_code_error(exc: Exception) -> UserCodeFailedError:
    try:
        raise exc
    except Exception:
        return UserCodeFailedError(sys.exc_info())


def _raises(err: UserCodeFailedError):
    def _side_effect(*_a: object, **_k: object) -> None:
        raise err

    return _side_effect


def _run_single_iteration(test_cls: type[PLTestCase]) -> PLTestResult:
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(test_cls)
    result = PLTestResult()
    suite.run(result)
    return result


class _StudentCodeSuite(PLTestCase):
    """Three 1-point tests; uses the REAL setUpClass, which runs student code via
    execute_code (patched in each test to raise)."""

    __test__ = False  # a fixture for the tests below, not collected by pytest
    student_code_file = "user_code.py"

    @points(1)
    @name("test one")
    def test_one(self):
        Feedback.set_score(1.0)

    @points(1)
    @name("test two")
    def test_two(self):
        Feedback.set_score(1.0)

    @points(1)
    @name("test three")
    def test_three(self):
        Feedback.set_score(1.0)


def test_runtime_error_keeps_all_tests():
    """A non-syntax student-code error must leave every test in the results with
    0 points, so the score denominator matches the entries shown."""
    err = _user_code_error(ValueError("student code blew up"))
    with patch.object(pl_unit_test, "execute_code", side_effect=_raises(err)):
        result = _run_single_iteration(_StudentCodeSuite)

    results = result.getResults()
    names = [r["name"] for r in results]
    for test_name in ("test one", "test two", "test three"):
        assert test_name in names, f"{test_name} missing -> tests were dropped"
        entry = next(r for r in results if r["name"] == test_name)
        assert entry["points"] == 0

    max_points = _StudentCodeSuite.get_total_points()
    earned = sum(r["points"] for r in results)
    score = 0 if math.isclose(float(max_points), 0) else earned / max_points
    assert earned == 0
    assert max_points == 3
    assert math.isclose(score, 0.0)
    assert result.getGradable() is True


def test_runtime_error_score_is_consistent():
    """The % (earned / get_total_points) and the visible test entries must agree
    -- the inconsistency reported in the issue."""
    err = _user_code_error(RuntimeError("boom"))
    with patch.object(pl_unit_test, "execute_code", side_effect=_raises(err)):
        result = _run_single_iteration(_StudentCodeSuite)

    results = result.getResults()
    test_entries = [r for r in results if r["filename"] != "error"]
    assert len(test_entries) == 3
    earned = sum(r["points"] for r in results)
    max_points = _StudentCodeSuite.get_total_points()
    # Denominator used for the % equals the count of authored tests, all shown.
    assert max_points == len(test_entries)
    assert earned == 0


def test_syntax_error_stays_ungradable():
    """A syntax error must remain ungradable with no padded test entries
    (unchanged behavior; the fix only touches the non-syntax branch)."""
    try:
        compile("def f(:\n    pass", "user_code.py", "exec")
    except SyntaxError:
        err = UserCodeFailedError(sys.exc_info())

    with patch.object(pl_unit_test, "execute_code", side_effect=_raises(err)):
        result = _run_single_iteration(_StudentCodeSuite)

    assert result.getGradable() is False
    assert result.getResults() == []
    assert result.format_errors == ["Your code has a syntax error."]


class _MultiIterSuite(PLTestCase):
    __test__ = False  # a fixture for the tests below, not collected by pytest
    total_iters = 3
    student_code_file = "user_code.py"

    @points(1)
    @name("alpha")
    def test_alpha(self):
        Feedback.set_score(1.0)

    @points(1)
    @name("beta")
    def test_beta(self):
        Feedback.set_score(1.0)


def test_multi_iteration_does_not_double_count():
    """With total_iters > 1, pl_main combines results by name across iterations.
    A user-code error each iteration must keep every test visible and the score
    at 0 without double-counting."""
    err = _user_code_error(RuntimeError("boom"))
    with patch.object(pl_unit_test, "execute_code", side_effect=_raises(err)):
        all_results = [
            _run_single_iteration(_MultiIterSuite).getResults()
            for _ in range(_MultiIterSuite.total_iters)
        ]

    combined: dict = defaultdict(lambda: {"max_points": 0, "points": 0})
    for res_list in all_results:
        for r in res_list:
            d = combined[r["name"]]
            d["points"] += r["points"]
            d["max_points"] += r["max_points"]
            d["name"] = r["name"]

    names = set(combined.keys())
    assert {"alpha", "beta"}.issubset(names)
    earned = sum(d["points"] for d in combined.values())
    max_points = _MultiIterSuite.get_total_points()
    score = 0 if math.isclose(float(max_points), 0) else earned / max_points
    assert earned == 0
    assert math.isclose(score, 0.0)
