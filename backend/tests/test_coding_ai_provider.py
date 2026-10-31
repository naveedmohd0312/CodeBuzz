import coding_ai_provider as provider


def test_coding_provider_prefers_its_own_config_over_mcq(monkeypatch):
    monkeypatch.setenv("CODING_API_KEY", "coding-test-secret")
    monkeypatch.setenv("CODING_MODEL", "coding-model")
    monkeypatch.setenv("CODING_API_BASE_URL", "https://coding.example/v1")
    monkeypatch.setenv("MCQ_API_KEY", "mcq-test-secret")
    monkeypatch.setenv("MCQ_MODEL", "mcq-model")
    assert provider._provider_config() == (
        "coding-test-secret", "coding-model", "https://coding.example/v1")


def test_coding_provider_posts_model_to_openai_compatible_endpoint(monkeypatch):
    monkeypatch.setenv("CODING_API_KEY", "coding-test-secret")
    monkeypatch.setenv("CODING_MODEL", "coding-model")
    monkeypatch.setenv("CODING_API_BASE_URL", "https://coding.example/v1")
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
    assert provider.request_coding_provider_json([{"role": "user", "content": "generate"}]) == {"ok": True}
    assert captured["url"] == "https://coding.example/v1/chat/completions"
    assert captured["json"]["model"] == "coding-model"
    assert captured["headers"]["Authorization"] == "Bearer coding-test-secret"
    assert captured["timeout"] == (10, 60)


def test_coding_provider_uses_shared_featherless_fallback(monkeypatch):
    for name in ("CODING_API_KEY", "CODING_MODEL", "CODING_API_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FEATHERLESS_API_KEY", "shared-test-secret")
    monkeypatch.setenv("FEATHERLESS_MODEL", "shared-model")
    assert provider._provider_config() == (
        "shared-test-secret", "shared-model", "https://api.featherless.ai/v1")
