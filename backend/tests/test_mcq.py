import pytest

import app as backend
from mcq_service import QUESTION_COUNT, validate_question_set


def question_set(topics=("Python",), difficulty="easy", level=1):
    return {"questions": [
        {"topic": topics[i % len(topics)], "difficulty": difficulty, "level": level,
         "question": f"Which Python fact is correct in case {i}?",
         "options": [f"Option {i}-{j}" for j in range(4)], "correct_answer": i % 4,
         "explanation": f"This explanation supports the correct response for item {i}."}
        for i in range(QUESTION_COUNT)
    ]}


def test_question_validation_rejects_wrong_count_and_unowned_topic():
    payload = question_set()
    payload["questions"].pop()
    with pytest.raises(ValueError, match="Exactly"):
        validate_question_set(payload, topics=["Python"], difficulty="easy", level=1)

    with pytest.raises(ValueError, match="outside"):
        validate_question_set(question_set(("Unrelated",)), topics=["Python"], difficulty="easy", level=1)


def test_question_validation_rejects_bad_options_answer_and_duplicate():
    payload = question_set()
    payload["questions"][0]["options"] = ["same", "same", "three", "four"]
    with pytest.raises(ValueError, match="duplicate options"):
        validate_question_set(payload, topics=["Python"], difficulty="easy", level=1)

    payload = question_set()
    payload["questions"][0]["correct_answer"] = 4
    with pytest.raises(ValueError, match="answer index"):
        validate_question_set(payload, topics=["Python"], difficulty="easy", level=1)

    payload = question_set()
    payload["questions"][1]["question"] = payload["questions"][0]["question"]
    with pytest.raises(ValueError, match="duplicates"):
        validate_question_set(payload, topics=["Python"], difficulty="easy", level=1)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(backend, "generate_mcqs", lambda portfolio, topics, difficulty, level, previous_questions=():
                        validate_question_set(question_set(tuple(topics), difficulty, level),
                                               topics=topics, difficulty=difficulty, level=level))
    test_app = backend.create_app({
        "TESTING": True,
        "SECRET_KEY": "test-secret",
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
        "UPLOAD_DIR": tmp_path / "uploads",
    })
    with test_app.app_context():
        backend.db.drop_all()
        backend.db.create_all()
        user = backend.User(full_name="Test Candidate", username="candidate", email="candidate@example.com",
                           password_hash="unused", is_email_verified=True, account_status="active")
        backend.db.session.add(user)
        backend.db.session.flush()
        backend.db.session.add(backend.CandidatePortfolio(user_id=user.id, domain="Backend",
                            skills=["Python"], technologies=[], programming_languages=["Python"],
                            dsa_topics=[], projects=[], education=[], experience=[], certifications=[]))
        other_user = backend.User(full_name="Other Candidate", username="another", email="another@example.com",
                                  password_hash="unused", is_email_verified=True, account_status="active")
        backend.db.session.add(other_user)
        backend.db.session.commit()
        user_id = user.id
        other_user_id = other_user.id
    test_client = test_app.test_client()
    with test_client.session_transaction() as session:
        session["user_id"] = user_id
    csrf_response = test_client.get("/api/auth/me")
    csrf = csrf_response.json["csrf_token"]
    test_client.environ_base["HTTP_X_CSRF_TOKEN"] = csrf
    return test_client, csrf, user_id, other_user_id


def test_track_is_independent_and_answer_key_is_hidden(client):
    test_client, csrf, _user_id, _other_user_id = client
    headers = {"X-CSRF-Token": csrf}
    for difficulty in ("easy", "medium", "hard"):
        response = test_client.post("/api/mcq/start", json={"difficulty": difficulty, "topics": ["Python"]}, headers=headers)
        assert response.status_code == 201
        assessment = response.json["assessment"]
        assert assessment["level"] == 1
        assert len(assessment["questions"]) == 10
        assert all("correct_answer" not in question and "explanation" not in question for question in assessment["questions"])
        for item in assessment["questions"][:7]:
            answer = (item["question_number"] - 1) % 4
            assert test_client.post(f"/api/mcq/assessment/{assessment['id']}/answer",
                                    json={"question_id": item["id"], "selected_answer": answer},
                                    headers=headers).status_code == 200
        assert test_client.post(f"/api/mcq/assessment/{assessment['id']}/submit", json={}, headers=headers).status_code == 200

    progress = test_client.get("/api/mcq/progress").json["progress"]
    assert progress["easy"]["highest_unlocked_level"] == 2
    assert progress["medium"]["highest_unlocked_level"] == 2
    assert progress["hard"]["highest_unlocked_level"] == 2


def test_failing_score_does_not_unlock_next_level(client):
    test_client, csrf, _user_id, _other_user_id = client
    headers = {"X-CSRF-Token": csrf}
    assessment = test_client.post("/api/mcq/start", json={"difficulty": "easy", "topics": ["Python"]}, headers=headers).json["assessment"]
    for item in assessment["questions"][:6]:
        assert test_client.post(f"/api/mcq/assessment/{assessment['id']}/answer",
                                json={"question_id": item["id"], "selected_answer": (item["question_number"] - 1) % 4},
                                headers=headers).status_code == 200
    result = test_client.post(f"/api/mcq/assessment/{assessment['id']}/submit", json={}, headers=headers).json
    assert result["result"]["score_percentage"] == 60.0
    assert result["result"]["passed"] is False
    assert test_client.get("/api/mcq/progress").json["progress"]["easy"]["highest_unlocked_level"] == 1
    assert test_client.post("/api/mcq/start", json={"difficulty": "easy", "topics": ["Python"]}, headers=headers).json["assessment"]["level"] == 1


def test_submission_is_idempotent_and_review_is_owner_scoped(client):
    test_client, csrf, _user_id, other_user_id = client
    headers = {"X-CSRF-Token": csrf}
    assessment = test_client.post("/api/mcq/start", json={"difficulty": "easy", "topics": ["Python"]}, headers=headers).json["assessment"]
    for item in assessment["questions"][:7]:
        response = test_client.post(f"/api/mcq/assessment/{assessment['id']}/answer",
                                    json={"question_id": item["id"], "selected_answer": item["question_number"] % 4},
                                    headers=headers)
        assert response.status_code == 200
    result = test_client.post(f"/api/mcq/assessment/{assessment['id']}/submit", json={}, headers=headers)
    assert result.status_code == 200
    second = test_client.post(f"/api/mcq/assessment/{assessment['id']}/submit", json={}, headers=headers)
    assert second.json["already_submitted"] is True
    assert len(test_client.get("/api/mcq/history").json["history"]) == 1

    with test_client.session_transaction() as session:
        session.clear()
        session["user_id"] = other_user_id
        session["csrf"] = csrf
    assert test_client.get(f"/api/mcq/review/{assessment['id']}").status_code == 404
