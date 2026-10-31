import pytest

import project_ai_provider as provider


def test_project_provider_prefers_project_specific_settings(monkeypatch):
    monkeypatch.setenv("PROJECT_API_KEY", "project-test-secret")
    monkeypatch.setenv("PROJECT_MODEL", "project-model")
    monkeypatch.setenv("PROJECT_API_BASE_URL", "https://project.example/v1")
    monkeypatch.setenv("MCQ_API_KEY", "mcq-test-secret")
    monkeypatch.setenv("MCQ_MODEL", "mcq-model")
    monkeypatch.setenv("FEATHERLESS_API_KEY", "shared-test-secret")
    monkeypatch.setenv("FEATHERLESS_MODEL", "shared-model")
    assert provider._provider_config() == (
        "project-test-secret", "project-model", "https://project.example/v1")


def test_project_provider_does_not_use_mcq_settings(monkeypatch):
    for name in ("PROJECT_API_KEY", "PROJECT_MODEL", "FEATHERLESS_API_KEY", "FEATHERLESS_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MCQ_API_KEY", "mcq-test-secret")
    monkeypatch.setenv("MCQ_MODEL", "mcq-model")
    with pytest.raises(provider.ProjectAIError, match="PROJECT_API_KEY and PROJECT_MODEL"):
        provider._provider_config()


def test_project_provider_uses_shared_featherless_fallback(monkeypatch):
    for name in ("PROJECT_API_KEY", "PROJECT_MODEL", "PROJECT_API_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FEATHERLESS_API_KEY", "shared-test-secret")
    monkeypatch.setenv("FEATHERLESS_MODEL", "shared-model")
    assert provider._provider_config() == (
        "shared-test-secret", "shared-model", "https://api.featherless.ai/v1")


def test_project_provider_sends_project_model_to_openai_compatible_endpoint(monkeypatch):
    monkeypatch.setenv("PROJECT_API_KEY", "project-test-secret")
    monkeypatch.setenv("PROJECT_MODEL", "project-model")
    monkeypatch.setenv("PROJECT_API_BASE_URL", "https://project.example/v1")
    captured = {}

    class Response:
        status_code = 200
        def raise_for_status(self):
            return None
        def json(self):
            return {"choices": [{"message": {"content": '{"ok":true}'}}]}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return Response()

    monkeypatch.setattr(provider.requests, "post", fake_post)
    assert provider.request_project_provider_json([{"role": "user", "content": "test"}]) == {"ok": True}
    assert captured["url"] == "https://project.example/v1/chat/completions"
    assert captured["json"]["model"] == "project-model"
    assert captured["headers"]["Authorization"] == "Bearer project-test-secret"
    assert captured["timeout"] == (10, 60)
