from datetime import timedelta

import pytest

import app as backend


@pytest.fixture
def performance_client(tmp_path):
    test_app = backend.create_app({"TESTING": True, "SECRET_KEY": "performance-test-secret",
        "SQLALCHEMY_DATABASE_URI": "sqlite://", "UPLOAD_DIR": tmp_path / "uploads"})
    with test_app.app_context():
        backend.db.drop_all()
        backend.db.create_all()
        user = backend.User(full_name="Performance Candidate", username="performer",
            email="performance@example.com", password_hash="unused", is_email_verified=True,
            account_status="active")
        backend.db.session.add(user)
        backend.db.session.flush()
        backend.db.session.add(backend.CandidatePortfolio(user_id=user.id, domain="Web Development",
            skills=["Python", "Arrays", "SQL"], technologies=["React", "Flask", "SQLite"],
            programming_languages=["Python"], dsa_topics=["Arrays"], projects=[]))
        now = backend.utcnow()
        assessment = backend.Assessment(user_id=user.id, assessment_type="mcq", domain="Backend",
            difficulty="easy", level=1, selected_topics=["Python", "Arrays"], total_questions=10,
            status="completed", started_at=now - timedelta(minutes=8), submitted_at=now - timedelta(minutes=2))
        backend.db.session.add(assessment)
        backend.db.session.flush()
        python_question = backend.MCQQuestion(assessment_id=assessment.id, question_number=1, topic="Python",
            question_text="Python question?", options=["a", "b", "c", "d"], correct_answer=0,
            explanation="Test explanation", difficulty="easy", level=1)
        arrays_question = backend.MCQQuestion(assessment_id=assessment.id, question_number=2, topic="Arrays",
            question_text="Array question?", options=["a", "b", "c", "d"], correct_answer=1,
            explanation="Test explanation", difficulty="easy", level=1)
        backend.db.session.add_all([python_question, arrays_question])
        backend.db.session.flush()
        backend.db.session.add_all([
            backend.CandidateAnswer(assessment_id=assessment.id, question_id=python_question.id,
                selected_answer=0, is_correct=True),
            backend.CandidateAnswer(assessment_id=assessment.id, question_id=arrays_question.id,
                selected_answer=2, is_correct=False),
            backend.AssessmentResult(assessment_id=assessment.id, user_id=user.id, difficulty="easy", level=1,
                total_questions=10, correct_answers=1, incorrect_answers=1, unanswered_questions=8,
                score_percentage=10, passed=False, attempt_number=1, completed_at=now - timedelta(minutes=2)),
        ])
        code_question = backend.CodingQuestion(user_id=user.id, difficulty="easy", topic="Python", level=1,
            content={"title": "Python sum", "supported_languages": ["python"]})
        backend.db.session.add(code_question)
        backend.db.session.flush()
        backend.db.session.add(backend.CodingSubmission(user_id=user.id, question_id=code_question.id,
            idempotency_key="a" * 32, programming_language="python", source_code="print(1)", attempt_number=1,
            passed_test_cases=3, total_test_cases=4, score_percentage=75, passed=True, status="Accepted",
            execution_time_ms=18, memory_kb=2000, test_results=[], hints_used=0, submitted_at=now))
        backend.db.session.commit()
        user_id = user.id
    client = test_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client


def test_performance_dashboard_aggregates_actual_mcq_and_coding_records(performance_client):
    response = performance_client.get("/api/performance")
    assert response.status_code == 200
    dashboard = response.json["dashboard"]
    assert dashboard["overview"]["assessments_completed"] == 2
    assert dashboard["category_performance"]["mcq"]["questions_attempted"] == 2
    assert dashboard["category_performance"]["mcq"]["correct"] == 1
    assert dashboard["category_performance"]["mcq"]["accuracy"] == 50
    assert dashboard["category_performance"]["coding"]["problems_attempted"] == 1
    assert dashboard["category_performance"]["coding"]["problems_solved"] == 1
    assert dashboard["category_performance"]["coding"]["test_cases_passed"] == 3
    assert dashboard["category_performance"]["coding"]["completion_time_tracked"] is False
    assert any(item["name"] == "Arrays" for item in dashboard["skills"])
    assert all(item["details_path"].startswith("/api/") for item in dashboard["history"])
    assert dashboard["trend"][-1]["overall"] is not None
