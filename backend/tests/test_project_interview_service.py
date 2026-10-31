from types import SimpleNamespace

import pytest

import project_interview_service as service
from project_ai_provider import ProjectAIProviderError


def test_question_generation_is_single_and_contextual(monkeypatch):
    seen = []
    def provider(messages, max_tokens):
        seen.append(messages)
        return {"question": "How did you implement student registration in this project?",
            "topic": "Feature implementation", "difficulty": "medium",
            "question_type": "Technical Explanation", "expected_concepts": ["request validation"],
            "evaluation_criteria": ["accurate flow"], "follow_up_context": "Check persistence details."}
    monkeypatch.setattr(service, "request_project_provider_json", provider)
    history = [{"question": "How did your React page request student data?", "answer": "I used Flask.",
                "score": 62, "evaluation": "The route was clear; query filtering was missing."}]
    result = service.generate_question({"name": "Student Management", "features": ["student registration"],
        "technologies": ["Flask", "React"]}, {"skills": ["Python"]}, history, "medium", 2)
    assert result["difficulty"] == "medium"
    assert len(seen) == 1
    assert "student registration" in seen[0][1]["content"]
    assert "query filtering was missing" in seen[0][1]["content"]


def test_question_generation_rejects_unrelated_or_duplicate_question(monkeypatch):
    monkeypatch.setattr(service, "request_project_provider_json", lambda *args, **kwargs: {
        "question": "Explain how you used Kubernetes to deploy this project.", "topic": "Architecture",
        "difficulty": "easy", "question_type": "Architecture and Design",
        "expected_concepts": ["deployment"], "evaluation_criteria": ["reasoning"], "follow_up_context": "Ask more."})
    project = {"name": "Student Management", "features": ["student records"], "technologies": ["Flask"]}
    with pytest.raises(ValueError, match="supported by the selected project"):
        service.generate_question(project, {}, [], "easy", 1)

    with pytest.raises(ValueError, match="repeated"):
        service.generate_question({"name": "Student Management", "features": ["student records"],
            "technologies": ["Kubernetes"]}, {}, [{"question": "Explain how you used Kubernetes to deploy this project."}], "easy", 2)


def test_question_generation_regenerates_once_for_invalid_ai_shape(monkeypatch):
    calls = []
    valid = {"question": "How did you implement student registration in this project?",
        "topic": "Feature implementation", "difficulty": "easy",
        "question_type": "Implementation Walkthrough", "expected_concepts": ["request validation"],
        "evaluation_criteria": ["accurate flow"], "follow_up_context": "Explore persistence details."}
    invalid = {**valid, "question_type": "unsupported format"}
    def provider(messages, max_tokens):
        calls.append(messages)
        return invalid if len(calls) == 1 else valid
    monkeypatch.setattr(service, "request_project_provider_json", provider)
    result = service.generate_question({"name": "Student Management", "features": ["student registration"],
        "technologies": ["Flask"]}, {"skills": ["Python"]}, [], "easy", 1)
    assert result["question_type"] == "Technical Explanation"
    assert len(calls) == 2
    assert "failed backend validation" in calls[1][1]["content"]


def test_question_generation_does_not_retry_provider_authentication_errors(monkeypatch):
    calls = []
    def provider(*args, **kwargs):
        calls.append(1)
        raise ProjectAIProviderError("provider auth failed", 401)
    monkeypatch.setattr(service, "request_project_provider_json", provider)
    with pytest.raises(ProjectAIProviderError):
        service.generate_question({"name": "Student Management", "features": ["student registration"]},
                                  {}, [], "easy", 1)
    assert calls == [1]


def test_answer_evaluation_rejects_invalid_and_calculates_backend_score(monkeypatch):
    question = SimpleNamespace(question_text="How did you retrieve student records?", topic="Database Retrieval",
        difficulty="medium", question_type="Technical Explanation", expected_concepts=["query"],
        evaluation_criteria=["filtering"])
    monkeypatch.setattr(service, "request_project_provider_json", lambda *args, **kwargs: {
        "correctness": 90, "technical_depth": 80, "relevance": 70,
        "feedback": "Accurate query explanation with useful detail.",
        "strengths": ["Understands filtering"], "weaknesses": ["No index discussion"],
        "topic": "Database Retrieval"})
    result = service.evaluate_answer({"name": "Student System"}, question, "Used a filtered query.", [])
    assert result["score"] == 81

    monkeypatch.setattr(service, "request_project_provider_json", lambda *args, **kwargs: {
        "correctness": True, "technical_depth": 80, "relevance": 70,
        "feedback": "Feedback.", "strengths": [], "weaknesses": [], "topic": "Database Retrieval"})
    with pytest.raises(ValueError, match="invalid answer scores"):
        service.evaluate_answer({}, question, "Answer", [])
