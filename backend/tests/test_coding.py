import pytest

import app as backend


def coding_question(topic, difficulty, level, languages):
    return {"title": f"{difficulty.title()} {topic} task {level}",
        "problem_statement": "Read a list of integers and write the required aggregate value.",
        "problem_description": "Return the deterministic sum of the provided integer values.",
        "input_format": "The first line has n; the next line has n integers.",
        "output_format": "Print the sum as one integer.", "constraints": ["1 <= n <= 1000"],
        "examples": [{"input": "3\n1 2 3", "output": "6", "explanation": "The three values sum to six."}],
        "topic": topic, "difficulty": difficulty, "level": level,
        "supported_languages": list(languages), "starter_code": {key: "# read input and print the result\n" for key in languages},
        "public_test_cases": [{"input": f"1\n{i}", "output": str(i)} for i in range(4)],
        "hidden_test_cases": [{"input": f"1\n{i}", "output": str(i)} for i in range(10)],
        "reference_solution": "import sys\nprint(sum(map(int, sys.stdin.read().split()[1:])))",
        "expected_time_complexity": "O(n)", "expected_space_complexity": "O(1)"}


@pytest.fixture
def coding_client(tmp_path, monkeypatch):
    monkeypatch.setattr(backend, "configured_languages", lambda: {
        "python": {"id": 71, "label": "Python 3", "monaco": "python"},
        "javascript": {"id": 63, "label": "JavaScript (Node.js)", "monaco": "javascript"},
    })
    monkeypatch.setattr(backend, "generate_coding_question", lambda portfolio, topic, difficulty, level, previous=(), languages=None:
                        coding_question(topic, difficulty, level, languages))

    def fake_run(source, language, cases, include_details=True):
        score = {"pass": 80, "exact": 70, "fail": 60}.get(source, 0)
        total = len(cases)
        passed = int(total * score / 100)
        return {"results": [{"case": i + 1, "passed": i < passed,
                             "status": "Accepted" if i < passed else "Wrong Answer"}
                            for i in range(total)], "passed": passed, "total": total,
                "score": round(passed / total * 100, 2) if total else 0,
                "execution_time_ms": 12.5, "memory_kb": 2048}
    monkeypatch.setattr(backend, "run_cases", fake_run)
    monkeypatch.setattr(backend, "get_hint", lambda question, language, hint_level, code="", previous_hints=():
                        f"Hint level {hint_level}: consider the input structure and output requirements.")
    test_app = backend.create_app({"TESTING": True, "SECRET_KEY": "coding-test-secret",
        "SQLALCHEMY_DATABASE_URI": "sqlite://", "UPLOAD_DIR": tmp_path / "uploads"})
    with test_app.app_context():
        backend.db.drop_all()
        backend.db.create_all()
        user = backend.User(full_name="Coding Candidate", username="coder", email="coder@example.com",
            password_hash="unused", is_email_verified=True, account_status="active")
        other = backend.User(full_name="Other Candidate", username="othercoder", email="othercoder@example.com",
            password_hash="unused", is_email_verified=True, account_status="active")
        backend.db.session.add_all([user, other])
        backend.db.session.flush()
        backend.db.session.add(backend.CandidatePortfolio(user_id=user.id, domain="Backend",
            skills=["Arrays", "Python"], technologies=[], programming_languages=["Python"],
            dsa_topics=["Arrays"], projects=[], education=[], experience=[], certifications=[]))
        backend.db.session.commit()
        user_id, other_id = user.id, other.id
    client = test_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    csrf = client.get("/api/auth/me").json["csrf_token"]
    return client, csrf, user_id, other_id


def start(client, csrf, difficulty="easy", topic="Arrays", language="python"):
    return client.post("/api/coding/start", json={"difficulty": difficulty, "topic": topic, "language": language},
                       headers={"X-CSRF-Token": csrf})


def submit(client, csrf, question_id, source, key):
    return client.post(f"/api/coding/question/{question_id}/submit",
        json={"source_code": source, "language": "python", "idempotency_key": key},
        headers={"X-CSRF-Token": csrf})


def test_coding_topics_and_languages_are_portfolio_validated(coding_client):
    client, csrf, _, _ = coding_client
    assert start(client, csrf, topic="Unrelated").status_code == 400
    assert start(client, csrf, language="javascript").status_code == 400
    assert client.post("/api/coding/start", json={"difficulty": "easy", "topic": "Arrays", "language": "python", "level": 50},
                       headers={"X-CSRF-Token": csrf}).status_code == 400
    assert client.post("/api/coding/start", json={"difficulty": "easy", "topic": "Arrays", "language": "python"}).status_code == 403


def test_coding_tracks_start_independently_and_hide_private_question_data(coding_client):
    client, csrf, _, _ = coding_client
    for difficulty in ("easy", "medium", "hard"):
        response = start(client, csrf, difficulty)
        assert response.status_code == 200
        question = response.json["question"]
        assert question["level"] == 1
        assert "hidden_test_cases" not in question
        assert "reference_solution" not in question
        assert "reference_check" not in question
    overview = client.get("/api/coding/overview").json
    assert all(overview["progress"][difficulty][0]["highest_unlocked_level"] == 1
               for difficulty in ("easy", "medium", "hard"))


def test_score_strictly_above_threshold_unlocks_only_same_track_and_retry_is_saved(coding_client):
    client, csrf, _, _ = coding_client
    q1 = start(client, csrf).json["question"]
    first = submit(client, csrf, q1["id"], "exact", "11111111-1111-4111-8111-111111111111")
    assert first.status_code == 200
    assert first.json["score_percentage"] == 70
    assert first.json["passed"] is False
    repeat = submit(client, csrf, q1["id"], "exact", "11111111-1111-4111-8111-111111111111")
    assert repeat.json["already_submitted"] is True
    retry = start(client, csrf).json["question"]
    assert retry["id"] == q1["id"] and retry["level"] == 1
    passed = submit(client, csrf, q1["id"], "pass", "22222222-2222-4222-8222-222222222222")
    assert passed.json["score_percentage"] == 80 and passed.json["passed"] is True
    next_level = start(client, csrf).json["question"]
    assert next_level["level"] == 2
    assert start(client, csrf, "medium").json["question"]["level"] == 1
    assert len(client.get("/api/coding/history").json["history"]) == 2


def test_run_is_not_a_formal_submission_and_submission_is_owner_scoped(coding_client):
    client, csrf, _, other_id = coding_client
    question = start(client, csrf).json["question"]
    run = client.post(f"/api/coding/question/{question['id']}/run", json={"source_code": "pass", "language": "python"},
                      headers={"X-CSRF-Token": csrf})
    assert run.status_code == 200
    assert len(client.get("/api/coding/history").json["history"]) == 0
    submission = submit(client, csrf, question["id"], "pass", "33333333-3333-4333-8333-333333333333").json
    with client.session_transaction() as session:
        session["user_id"] = other_id
        session["csrf"] = csrf
    assert client.get(f"/api/coding/submission/{submission['id']}").status_code == 404


def test_performance_is_provisional_and_project_score_is_not_fabricated(coding_client):
    client, csrf, _, _ = coding_client
    before = client.get("/api/performance").json["performance"]
    assert before["scores"] == {"mcq": None, "coding": None, "project": None}
    q = start(client, csrf).json["question"]
    submit(client, csrf, q["id"], "pass", "44444444-4444-4444-8444-444444444444")
    after = client.get("/api/performance").json["performance"]
    assert after["scores"]["coding"] == 80
    assert after["scores"]["project"] is None
    assert after["provisional"] is True
    assert after["eligible_for_final_overall_rank"] is False
    assert after["pipeline_details"]["coding"]["test_cases_passed"] == 8
    assert after["pipeline_ranks"]["coding"] == 1
    assert client.get("/api/leaderboard?pipeline=overall").json["ranked_candidates"] == []


def test_draft_is_server_persisted_per_question_language_and_versioned(coding_client):
    client, csrf, _, _ = coding_client
    question = start(client, csrf).json["question"]
    path = f"/api/coding/question/{question['id']}/draft?language=python"
    initial = client.get(path)
    assert initial.status_code == 200
    assert initial.json["draft"] is None and initial.json["revision"] == 0
    saved = client.put(f"/api/coding/question/{question['id']}/draft", json={
        "source_code": "print('saved')", "language": "python", "revision": 1},
        headers={"X-CSRF-Token": csrf})
    assert saved.status_code == 200
    assert client.get(path).json["draft"] == "print('saved')"
    stale = client.put(f"/api/coding/question/{question['id']}/draft", json={
        "source_code": "old value", "language": "python", "revision": 0},
        headers={"X-CSRF-Token": csrf})
    assert stale.status_code == 409
    assert client.get(path).json["draft"] == "print('saved')"


def test_draft_is_owner_scoped_and_run_and_submit_use_separate_case_sets(coding_client, monkeypatch):
    client, csrf, _, other_id = coding_client
    question = start(client, csrf).json["question"]
    calls = []
    def fake_run(source, language, cases, include_details=True):
        calls.append((len(cases), include_details))
        total = len(cases)
        return {"results": [{"case": i + 1, "passed": True, "status": "Accepted"} for i in range(total)],
                "passed": total, "total": total, "score": 100.0,
                "execution_time_ms": 4.0, "memory_kb": 1200}
    monkeypatch.setattr(backend, "run_cases", fake_run)
    run = client.post(f"/api/coding/question/{question['id']}/run", json={
        "source_code": "pass", "language": "python"}, headers={"X-CSRF-Token": csrf})
    assert run.status_code == 200
    assert run.json["total"] == 4
    official = submit(client, csrf, question["id"], "pass", "55555555-5555-4555-8555-555555555555")
    assert official.status_code == 200
    assert official.json["total_test_cases"] == 10
    assert all("input" not in row and "expected_output" not in row and "actual_output" not in row
               for row in official.json["test_results"])
    assert "reference_solution" not in official.json
    assert calls == [(4, True), (10, False)]
    with client.session_transaction() as session:
        session["user_id"] = other_id
        session["csrf"] = csrf
    assert client.get(f"/api/coding/question/{question['id']}/draft?language=python").status_code == 404
