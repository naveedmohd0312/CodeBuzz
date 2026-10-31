import pytest
from sqlalchemy import create_engine, inspect, text

import app as backend


def test_sqlite_upgrade_adds_missing_evaluation_timestamp_without_losing_answers():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE project_interview_answer (id INTEGER PRIMARY KEY, answer_text TEXT NOT NULL)")
        connection.exec_driver_sql(
            "INSERT INTO project_interview_answer (id, answer_text) VALUES (1, 'saved candidate answer')")

    backend.upgrade_existing_sqlite_schema(engine)
    backend.upgrade_existing_sqlite_schema(engine)  # startup upgrade is safe to rerun

    columns = {column["name"] for column in inspect(engine).get_columns("project_interview_answer")}
    with engine.connect() as connection:
        row = connection.execute(text(
            "SELECT answer_text, evaluation_started_at FROM project_interview_answer WHERE id = 1")).one()
    assert "evaluation_started_at" in columns
    assert row == ("saved candidate answer", None)
    engine.dispose()


@pytest.fixture
def interview_client(tmp_path, monkeypatch):
    calls = {"generated": [], "evaluated": []}
    monkeypatch.setattr(backend, "project_interview_rules", lambda: {
        "question_count": 3, "increase_at": 80, "decrease_below": 50})

    def generate(project, profile, history, difficulty, number):
        calls["generated"].append({"history": list(history), "difficulty": difficulty, "number": number})
        return {"question": f"Question {number}: how did you implement {project['features'][0]}?",
            "topic": "Feature implementation", "difficulty": difficulty,
            "question_type": "Technical Explanation", "expected_concepts": ["API flow", "data retrieval"],
            "evaluation_criteria": ["accurate implementation", "relevant detail"],
            "follow_up_context": "Explore details that remain unclear."}

    def evaluate(project, question, answer, history):
        calls["evaluated"].append({"question": question.question_text, "answer": answer, "history": list(history)})
        score = 90 if "strong" in answer.lower() else (35 if "weak" in answer.lower() else 70)
        return {"score": score, "correctness": score, "technical_depth": score,
            "relevance": score, "feedback": "The explanation addressed the implementation question.",
            "strengths": ["Explained the feature flow"], "weaknesses": ["Add validation detail"],
            "topic": "Feature implementation"}

    monkeypatch.setattr(backend, "generate_project_question", generate)
    monkeypatch.setattr(backend, "evaluate_project_answer", evaluate)
    test_app = backend.create_app({"TESTING": True, "SECRET_KEY": "interview-test-secret",
        "SQLALCHEMY_DATABASE_URI": "sqlite://", "UPLOAD_DIR": tmp_path / "uploads"})
    with test_app.app_context():
        backend.db.drop_all()
        backend.db.create_all()
        user = backend.User(full_name="Interview Candidate", username="interviewee",
            email="interview@example.com", password_hash="unused", is_email_verified=True,
            account_status="active")
        other = backend.User(full_name="Other Candidate", username="otherinterviewee",
            email="other@example.com", password_hash="unused", is_email_verified=True,
            account_status="active")
        backend.db.session.add_all([user, other])
        backend.db.session.flush()
        backend.db.session.add(backend.CandidatePortfolio(user_id=user.id, domain="Web Development",
            skills=["Python", "SQL"], technologies=["Flask", "React", "SQLite"],
            programming_languages=["Python"], projects=[{
                "name": "Student Management System", "description": "Manage student records.",
                "project_domain": "Education", "technologies": ["Flask", "SQLite", "React"],
                "features": ["student registration", "student search"],
                "claimed_contributions": ["built the REST API"]}], experience=[]))
        backend.db.session.commit()
        ids = (user.id, other.id)
    client = test_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = ids[0]
    csrf = client.get("/api/auth/me").json["csrf_token"]
    return client, csrf, ids, calls


def start(client, csrf, project_index=0):
    return client.post("/api/project-interview/start", json={"project_index": project_index},
        headers={"X-CSRF-Token": csrf})


def answer(client, csrf, session_id, question, text):
    return client.post(f"/api/project-interview/session/{session_id}/answer",
        json={"question_id": question["id"], "answer": text}, headers={"X-CSRF-Token": csrf})


def test_project_selection_is_portfolio_owned_and_context_is_actual(interview_client):
    client, csrf, _, calls = interview_client
    projects = client.get("/api/project-interview/projects").json["projects"]
    assert projects[0]["name"] == "Student Management System"
    assert projects[0]["features"] == ["student registration", "student search"]
    assert start(client, csrf, 77).status_code == 404
    result = start(client, csrf)
    assert result.status_code == 200
    assert result.json["session"]["question"]["difficulty"] == "easy"
    assert len(calls["generated"]) == 1


def test_adaptive_followups_are_sequential_and_report_is_saved(interview_client):
    client, csrf, _, calls = interview_client
    first = start(client, csrf).json["session"]
    session_id = first["id"]
    result = answer(client, csrf, session_id, first["question"], "A strong explanation of student registration.")
    assert result.status_code == 200
    second = result.json["question"]
    assert second["difficulty"] == "medium"
    assert calls["generated"][-1]["history"][-1]["answer"].startswith("A strong")
    assert calls["generated"][-1]["history"][-1]["score"] == 90
    # Medium answer below 50 moves down to Easy.
    result = answer(client, csrf, session_id, second, "A weak answer.")
    assert result.status_code == 200
    third = result.json["question"]
    assert third["difficulty"] == "easy"
    result = answer(client, csrf, session_id, third, "A reasonable answer.")
    assert result.status_code == 200 and result.json["completed"] is True
    report = result.json["report"]
    assert report["question_count"] == 3
    assert report["overall_score"] == 65
    assert len(report["difficulty_progression"]) == 3
    saved = client.get(f"/api/project-interview/session/{session_id}/report")
    assert saved.json["report"] == report
    performance = client.get("/api/performance").json
    assert performance["performance"]["scores"]["project"] == 65
    assert performance["dashboard"]["overview"]["assessments_completed"] == 1
    assert performance["dashboard"]["category_performance"]["project"]["questions_answered"] == 3
    assert performance["dashboard"]["history"][0]["details_path"] == f"/api/project-interview/session/{session_id}/report"
    assert performance["dashboard"]["trend"][-1]["project"] == 65
    board = client.get("/api/leaderboard?pipeline=project")
    assert board.json["ranked_candidates"][0]["score"] == 65


def test_answers_are_idempotent_and_other_candidates_cannot_read_session(interview_client):
    client, csrf, ids, calls = interview_client
    session = start(client, csrf).json["session"]
    submitted = answer(client, csrf, session["id"], session["question"], "A strong answer.")
    assert submitted.status_code == 200
    count = len(calls["evaluated"])
    again = answer(client, csrf, session["id"], session["question"], "A strong answer.")
    assert again.status_code == 200
    assert len(calls["evaluated"]) == count
    with client.session_transaction() as auth_session:
        auth_session["user_id"] = ids[1]
    assert client.get(f"/api/project-interview/session/{session['id']}").status_code == 404
    assert client.get(f"/api/project-interview/session/{session['id']}/report").status_code == 404


def test_saved_answer_survives_evaluation_and_followup_provider_failures(interview_client, monkeypatch):
    client, csrf, _, _ = interview_client
    session = start(client, csrf).json["session"]
    original_evaluate = backend.evaluate_project_answer
    monkeypatch.setattr(backend, "evaluate_project_answer", lambda *args: (_ for _ in ()).throw(backend.ProjectAIError("temporary")))
    failed = answer(client, csrf, session["id"], session["question"], "A strong answer that must remain saved.")
    assert failed.status_code == 503
    monkeypatch.setattr(backend, "evaluate_project_answer", original_evaluate)
    retried = answer(client, csrf, session["id"], session["question"], "A strong answer that must remain saved.")
    assert retried.status_code == 200


def test_evaluated_answer_is_kept_when_next_question_generation_fails(interview_client, monkeypatch):
    client, csrf, _, _ = interview_client
    session = start(client, csrf).json["session"]
    original_generate = backend.generate_project_question
    monkeypatch.setattr(backend, "generate_project_question", lambda *args: (_ for _ in ()).throw(backend.ProjectAIError("temporary")))
    failed = answer(client, csrf, session["id"], session["question"], "A strong answer.")
    assert failed.status_code == 503
    assert failed.json["evaluation"]["score"] == 90
    monkeypatch.setattr(backend, "generate_project_question", original_generate)
    resumed = client.post(f"/api/project-interview/session/{session['id']}/continue", json={},
        headers={"X-CSRF-Token": csrf})
    assert resumed.status_code == 200
    assert resumed.json["question"]["difficulty"] == "medium"


def test_adaptive_threshold_boundaries():
    rules = {"question_count": 6, "increase_at": 80, "decrease_below": 50}
    assert backend.next_project_difficulty("easy", 79, rules)[0] == "easy"
    assert backend.next_project_difficulty("easy", 80, rules)[0] == "medium"
    assert backend.next_project_difficulty("medium", 49, rules)[0] == "easy"
    assert backend.next_project_difficulty("medium", 50, rules)[0] == "medium"
    assert backend.next_project_difficulty("hard", 100, rules)[0] == "hard"


def test_performance_dashboard_has_real_empty_state_without_assessments(interview_client):
    client, _, _, _ = interview_client
    dashboard = client.get("/api/performance").json["dashboard"]
    assert dashboard["overview"]["overall_score"] is None
    assert dashboard["overview"]["assessments_completed"] == 0
    assert dashboard["trend"] == []
    assert dashboard["categories"] == []
    assert dashboard["history"] == []
