import json

import pytest

import coding_runner
from coding_runner import RunnerError
import coding_ai_provider
import coding_service
from coding_service import CodingQuestionError, get_hint, validate_question
from coding_ai_provider import CodingAIProviderError


def valid_payload():
    return {"title": "Sum the values", "problem_statement": "Read several integers and print their sum.",
        "problem_description": "Return the sum of every integer in the input sequence.",
        "input_format": "First line n; second line n integers.", "output_format": "One integer sum.",
        "constraints": ["1 <= n <= 10"], "examples": [{"input": "2\n1 2", "output": "3",
        "explanation": "One plus two equals three."}], "topic": "Arrays", "difficulty": "easy", "level": 1,
        "supported_languages": ["python"], "starter_code": {"python": "# solution\n"},
        "public_test_cases": [{"input": "2\n1 2", "output": "3"},
                              *[{"input": f"1\n{i}", "output": str(i)} for i in (1, 2)]],
        "hidden_test_cases": [{"input": f"1\n{i}", "output": str(i)} for i in (3, 4, 5, 6)],
        "reference_solution": "import sys\nprint(sum(map(int, sys.stdin.read().split()[1:])))",
        "expected_time_complexity": "O(n)", "expected_space_complexity": "O(1)"}


def test_coding_question_validator_checks_selected_topic_and_supported_languages():
    raw = valid_payload()
    validated = validate_question(raw, topic="Arrays", difficulty="easy", level=1,
                                  languages={"python": {"id": 71, "label": "Python 3"}})
    assert validated["reference_solution_language"] == "python"
    assert len(validated["public_test_cases"]) == 3
    with pytest.raises(ValueError, match="topic"):
        validate_question(raw, topic="Graphs", difficulty="easy", level=1,
                          languages={"python": {"id": 71, "label": "Python 3"}})
    raw["supported_languages"] = ["javascript"]
    with pytest.raises(ValueError, match="language metadata"):
        validate_question(raw, topic="Arrays", difficulty="easy", level=1,
                          languages={"python": {"id": 71, "label": "Python 3"}})


def test_coding_question_validator_rejects_incomplete_cases_and_duplicates():
    raw = valid_payload()
    raw["hidden_test_cases"] = []
    with pytest.raises(ValueError, match="hidden_test_cases"):
        validate_question(raw, topic="Arrays", difficulty="easy", level=1,
                          languages={"python": {"id": 71, "label": "Python 3"}})
    raw = valid_payload()
    prior = [raw["title"] + " " + raw["problem_statement"]]
    with pytest.raises(ValueError, match="similar"):
        validate_question(raw, topic="Arrays", difficulty="easy", level=1,
                          languages={"python": {"id": 71, "label": "Python 3"}}, previous=prior)


@pytest.mark.parametrize("mutate", [
    lambda q: q.update(difficulty="expert"),
    lambda q: q.update(level=True),
    lambda q: q.update(constraints=[1]),
    lambda q: q.update(starter_code={"python": None}),
    lambda q: q.update(supported_languages=["python", "ruby"]),
])
def test_question_validator_rejects_invalid_metadata_and_types(mutate):
    raw = valid_payload()
    mutate(raw)
    with pytest.raises(ValueError):
        validate_question(raw, topic="Arrays", difficulty="easy", level=1,
                          languages={"python": {"id": 71, "label": "Python 3"}})


def test_question_validator_rejects_cross_collection_overlap_and_example_mismatch():
    raw = valid_payload()
    raw["hidden_test_cases"][0] = dict(raw["public_test_cases"][1])
    with pytest.raises(ValueError, match="distinct"):
        validate_question(raw, topic="Arrays", difficulty="easy", level=1,
                          languages={"python": {"id": 71, "label": "Python 3"}})
    raw = valid_payload()
    raw["examples"][0]["output"] = "999"
    with pytest.raises(ValueError, match="match a public"):
        validate_question(raw, topic="Arrays", difficulty="easy", level=1,
                          languages={"python": {"id": 71, "label": "Python 3"}})


def test_question_validator_derives_missing_example_from_public_case_only():
    raw = valid_payload()
    raw["examples"] = []
    validated = validate_question(raw, topic="Arrays", difficulty="easy", level=1,
                                  languages={"python": {"id": 71, "label": "Python 3"}})
    assert validated["examples"][0]["input"] == validated["public_test_cases"][0]["input"]
    assert validated["examples"][0]["output"] == validated["public_test_cases"][0]["output"]


@pytest.mark.parametrize("level", [1, 2, 3, 4])
def test_hint_levels_are_supported_and_bounded(level, monkeypatch):
    captured = {}
    monkeypatch.setattr(coding_service, "request_coding_provider_json", lambda messages, **kwargs:
                        captured.update({"messages": messages}) or {"hint": "Consider how the input is structured."})
    question = {"title": "Sum", "problem_statement": "Sum the values in the input.",
                "input_format": "Integers", "output_format": "Sum", "constraints": ["n <= 10"],
                "supported_languages": ["python"]}
    assert get_hint(question, "python", level, "print(1)").startswith("Consider")
    assert "reference_solution" not in captured["messages"][1]["content"]


def test_hint_rejects_bad_language_level_and_malformed_or_oversized_response(monkeypatch):
    question = {"title": "Sum", "problem_statement": "Sum the values in the input.",
                "input_format": "Integers", "output_format": "Sum", "constraints": ["n <= 10"],
                "supported_languages": ["python"]}
    with pytest.raises(ValueError):
        get_hint(question, "ruby", 1)
    with pytest.raises(ValueError):
        get_hint(question, "python", True)
    with pytest.raises(ValueError):
        get_hint(question, "python", 1, code=object())
    monkeypatch.setattr(coding_service, "request_coding_provider_json", lambda *a, **kw: {"hint": "```python\nsolution\n```"})
    with pytest.raises(CodingQuestionError):
        get_hint(question, "python", 1)
    monkeypatch.setattr(coding_service, "request_coding_provider_json", lambda *a, **kw: {"hint": "word " * 121})
    with pytest.raises(CodingQuestionError):
        get_hint(question, "python", 1)


def test_generation_runs_reference_cases_and_retries_invalid_content(monkeypatch):
    responses = iter([{"not": "a question"}, valid_payload(), {"valid": True}])
    monkeypatch.setattr(coding_service, "request_coding_provider_json", lambda *a, **kw: next(responses))
    monkeypatch.setattr(coding_service, "run_cases", lambda source, language, cases: {
        "passed": len(cases), "total": len(cases)})
    question = coding_service.generate_coding_question({}, "Arrays", "easy", 1,
        languages={"python": {"id": 71, "label": "Python 3"}})
    assert question["reference_check"]["passed"] == 7


def test_generation_rejects_reference_solution_failure(monkeypatch):
    monkeypatch.setattr(coding_service, "request_coding_provider_json", lambda *a, **kw: valid_payload())
    monkeypatch.setattr(coding_service, "run_cases", lambda *a, **kw: {"passed": 0, "total": 7})
    with pytest.raises(CodingQuestionError, match="could not produce"):
        coding_service.generate_coding_question({}, "Arrays", "easy", 1,
            languages={"python": {"id": 71, "label": "Python 3"}})


def test_provider_failure_does_not_trigger_extra_generation_round(monkeypatch):
    calls = []
    def fail(*args, **kwargs):
        calls.append(1)
        raise CodingAIProviderError("safe provider failure", 401)
    monkeypatch.setattr(coding_service, "request_coding_provider_json", fail)
    with pytest.raises(CodingQuestionError, match="temporarily unavailable"):
        coding_service.generate_coding_question({}, "Arrays", "easy", 1,
            languages={"python": {"id": 71, "label": "Python 3"}})
    assert len(calls) == 1


def test_runner_config_requires_secure_configured_isolated_endpoint(monkeypatch):
    monkeypatch.delenv("JUDGE0_BASE_URL", raising=False)
    with pytest.raises(RunnerError, match="not configured"):
        coding_runner.execute("print(1)", "python", "")
    monkeypatch.setenv("JUDGE0_BASE_URL", "https://judge0.example")
    monkeypatch.setenv("JUDGE0_LANGUAGES", json.dumps({"python": {"id": 71, "label": "Python 3"}}))
    with pytest.raises(RunnerError, match="not enabled"):
        coding_runner.execute("print(1)", "ruby", "")


def test_runner_uses_server_limits_and_disables_network(monkeypatch):
    monkeypatch.setenv("JUDGE0_BASE_URL", "https://judge0.example")
    monkeypatch.setenv("JUDGE0_API_KEY", "server-test-key")
    monkeypatch.setenv("JUDGE0_LANGUAGES", json.dumps({"python": {"id": 71, "label": "Python 3"}}))
    captured = {}

    class Response:
        def __init__(self, data): self.data = data; self.status_code = 200
        def raise_for_status(self): pass
        def json(self): return self.data

    def fake_post(url, **kwargs):
        captured.update(kwargs)
        return Response({"token": "opaque-token"})

    monkeypatch.setattr(coding_runner.requests, "post", fake_post)
    monkeypatch.setattr(coding_runner.requests, "get", lambda *args, **kwargs: Response({
        "status": {"id": 3, "description": "Accepted"}, "stdout": "42\n", "stderr": None,
        "compile_output": None, "message": None, "time": "0.01", "memory": 1280}))
    result = coding_runner.execute("print(42)", "python", "", limits={"cpu_time_limit": 100, "memory_limit": 999999})
    assert result["stdout"] == "42\n"
    payload = captured["json"]
    assert payload["enable_network"] is False
    assert payload["cpu_time_limit"] == 5
    assert payload["memory_limit"] == 256000
    assert captured["headers"]["X-Auth-Token"] == "server-test-key"


def test_runner_scores_actual_outputs_deterministically(monkeypatch):
    monkeypatch.setattr(coding_runner, "execute", lambda source, language, stdin, **kwargs: {
        "status": "Accepted", "stdout": stdin[::-1], "stderr": "", "compile_output": "",
        "message": "", "time": "0.01", "memory": 1024})
    cases = [{"input": "abc", "output": "cba"}, {"input": "123", "output": "wrong"}]
    result = coding_runner.run_cases("unused", "python", cases)
    assert result["passed"] == 1
    assert result["total"] == 2
    assert result["score"] == 50
    hidden = coding_runner.run_cases("unused", "python", cases, include_details=False)
    assert all("input" not in item and "expected_output" not in item for item in hidden["results"])


def test_runner_caps_oversized_stdout_and_does_not_score_truncated_output(monkeypatch):
    monkeypatch.setattr(coding_runner, "execute", lambda *a, **kw: {
        "status": "Accepted", "stdout": "A" * (coding_runner.MAX_STDOUT_BYTES + 10),
        "stdout_truncated": True, "stderr": "", "compile_output": "", "message": "",
        "time": "0.01", "memory": 1024})
    result = coding_runner.run_cases("unused", "python", [{"input": "", "output": "A"}])
    assert result["passed"] == 0
    bounded, truncated = coding_runner._bounded_text("x" * 100, 10)
    assert len(bounded) == 10 and truncated
