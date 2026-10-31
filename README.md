# CodeBuzz

CodeBuzz is an AI-powered, portfolio-driven technical assessment platform. Phase 1 provides candidate registration, email verification, local portfolio extraction, authentication, and a candidate dashboard. Phase 2 adds portfolio-personalized MCQ assessments with independent Easy, Medium, and Hard progression tracks. Phase 3 adds portfolio-personalized coding challenges, isolated code execution, and performance/leaderboard adapters.

## Architecture

- `frontend/`: React 19 + Vite single-page application.
- `backend/`: Flask API, SQLAlchemy models, SQLite by default, private uploads under `backend/instance/uploads/`.
- Authentication uses Flask's signed, HTTP-only session cookie. In production, serve the frontend and API from the same site and set `COOKIE_SECURE=true`.
- Coding question generation shares the existing backend-only OpenAI-compatible assessment provider. Candidate source is sent only to a separate Judge0 service; Flask never executes submitted code.
- No Project-Based Assessment models or results exist yet. Its score remains unavailable, provisional weighted performance is labelled, and final overall ranks are withheld until there is a real project result pipeline.
- With email OTP enabled, signup details and the uploaded file are held in a temporary registration for up to 30 minutes; the `User` account is created after a valid OTP. OTP is disabled by default, so signup creates an active account and signs in immediately.

## Requirements

- Node.js 20 or newer and npm.
- Python 3.10 or newer.

## Setup

1. Copy `.env.example` to `backend/.env` and configure `SECRET_KEY`. Configure MCQ and coding generation with their respective server-side provider settings (or shared Featherless fallback values). Portfolio extraction remains local. Never put provider credentials in frontend variables or source files.
2. Backend (PowerShell):

   ```powershell
   cd backend
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   flask --app app run --debug
   ```

3. Frontend, in a second terminal:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

Open the Vite URL, usually `http://localhost:5173`. Vite proxies `/api` to Flask at `http://localhost:5000`.

## Configuration

See `.env.example`. Email OTP is disabled by default (`EMAIL_OTP_ENABLED=false`): signup activates the candidate and signs them in without sending email. To restore OTP later, set `EMAIL_OTP_ENABLED=true` and configure SMTP. Resume and portfolio extraction uses local PDF/DOCX text extraction, section detection, regular expressions, and a predefined skills dictionary; it does not call Gemini or OpenRouter. MCQ generation is isolated in `backend/mcq_service.py`. Coding question generation and hints use the separate `backend/coding_ai_provider.py` Featherless client. Configure their credentials independently with `MCQ_API_KEY`, `MCQ_MODEL`, `CODING_API_KEY`, and `CODING_MODEL`, or let either service use the shared `FEATHERLESS_API_KEY`, `FEATHERLESS_MODEL`, and `FEATHERLESS_BASE_URL` fallback. All provider credentials remain backend-only. Legacy provider settings remain separate for other AI features. Manual portfolio edits remain available.

For Gmail SMTP, set `MAIL_SERVER=smtp.gmail.com`, `MAIL_PORT=587`, and `MAIL_USE_TLS=true`. Use your Gmail address for `MAIL_USERNAME` and `MAIL_DEFAULT_SENDER`, and a Google App Password for `MAIL_PASSWORD` (not your normal Gmail password). Google requires 2-Step Verification for App Passwords; see [Google's App Password help](https://support.google.com/accounts/answer/185833?hl=en-IN). Restart Flask after saving `.env`.

`DATABASE_URL` defaults to `sqlite:///codebuzz.db` in Flask's instance directory. Set `UPLOAD_DIR` to a private, persistent location in deployments. Set `COOKIE_SECURE=true` when serving over HTTPS.

## API

- `POST /api/auth/signup` (multipart form)
- `POST /api/auth/verify-otp`, `POST /api/auth/resend-otp`
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/portfolio`, `POST /api/portfolio/upload`, `POST /api/portfolio/extract`, `POST /api/portfolio/retry-extraction`, `PUT /api/portfolio/update`
- `GET /api/dashboard`
- `GET /api/mcq/overview`, `GET /api/mcq/skills`, `GET /api/mcq/progress`, `GET /api/mcq/history`
- `POST /api/mcq/start`, `GET /api/mcq/assessment/<id>`, `POST /api/mcq/assessment/<id>/answer`, `POST /api/mcq/assessment/<id>/submit`
- `GET /api/mcq/result/<id>`, `GET /api/mcq/review/<id>`
- `GET /api/coding/overview`, `GET /api/coding/languages`, `GET /api/coding/progress`, `GET /api/coding/history`
- `POST /api/coding/start`, `GET /api/coding/question/<id>`, `GET|PUT /api/coding/question/<id>/draft`, `POST /api/coding/question/<id>/run`, `POST /api/coding/question/<id>/submit`, `POST /api/coding/question/<id>/hint`
- `GET /api/coding/submission/<id>`, `GET /api/performance`, `GET /api/leaderboard?pipeline=overall|mcq|coding|project`

MCQ scores are calculated on the server. Each assessment has ten questions; 70% passes and unlocks the next level only in that difficulty track. Correct answers and explanations are withheld until the candidate submits.

## Coding assessment and performance

Coding requires a dedicated Judge0 CE instance (`JUDGE0_BASE_URL`). Use an isolated deployment configured with restrictive CPU, wall-time, memory, process, file-size and network limits; each job requests network access disabled. Configure `JUDGE0_API_KEY` if the service requires authentication. Set `JUDGE0_LANGUAGES` to a JSON map of IDs and labels copied from that instance's `/languages` endpoint, for example `{"python":{"id":71,"label":"Python 3","monaco":"python"}}`. The app intersects these languages with the candidate's stored programming languages. It refuses execution without an HTTPS runner (HTTP is allowed only for localhost when `JUDGE0_ALLOW_HTTP=true`). Keep the runner separate from production secrets and databases. See the [Judge0 CE API reference](https://ce.judge0.com/) for its sandboxed submission API and resource limits.

The existing React coding workspace uses Monaco with backend-provided Judge0 language identifiers and starter code. Run Code executes visible test cases (or the candidate's optional custom input) without changing official scores; Submit Solution executes hidden cases only, saves an attempt and uses `passed / total * 100`. `CODING_PASS_PERCENT` defaults to 70, and progression requires a score strictly greater than the threshold. Draft code is autosaved per candidate, question and language to the database with version checks, and restored on reopen. Difficulty and topic tracks progress independently. Performance weights default to MCQ 30%, coding 40%, and project 30%; configure them with `PERFORMANCE_SCORE_WEIGHTS` JSON. Project interview results use each candidate's best completed interview per selected portfolio project, averaged across projects. Repeated attempts do not add weight. Provisional scores normalize over pipelines with actual scores; missing scores are never zeros. Final overall ranks require actual results for all three pipelines.

## Adaptive Project-Based Interview

The interview selects a project from `CandidatePortfolio.projects` (the existing JSON field), snapshots its extracted description, features, technologies, and candidate portfolio context into a user-owned interview session, and generates one Featherless question at a time. Candidate answers are saved before AI evaluation; evaluation uses correctness (40%), technical depth (30%), and relevance (30%), with the final question score computed by Flask. Difficulty increases at scores of 80 or above, decreases below 50, and otherwise stays the same. Defaults are six questions, with bounds configurable through `PROJECT_INTERVIEW_QUESTION_COUNT`, `PROJECT_INTERVIEW_INCREASE_AT`, and `PROJECT_INTERVIEW_DECREASE_BELOW`. SQL/code questions use a text-answer interface and are evaluated descriptively; arbitrary SQL is never run against the production database. The project interview uses its own `PROJECT_API_KEY`, `PROJECT_MODEL`, and `PROJECT_API_BASE_URL` settings, falling back only to shared `FEATHERLESS_API_KEY`, `FEATHERLESS_MODEL`, and `FEATHERLESS_BASE_URL`. It does not read MCQ provider configuration. Credentials remain backend-only.

Project interview APIs:

- `GET /api/project-interview/projects` and `GET /api/project-interview/sessions`
- `POST /api/project-interview/start` with `{ "project_index": 0 }`
- `GET /api/project-interview/session/<id>`
- `POST /api/project-interview/session/<id>/answer` with `{ "question_id": 1, "answer": "..." }`
- `POST /api/project-interview/session/<id>/continue` to retry a failed next-question generation
- `GET /api/project-interview/session/<id>/report`

All mutation requests require the session CSRF token. The project leaderboard ranks completed project scores, and overall ranks are published only when a candidate has scores from MCQ, coding, and project interviews.

`GET /api/performance` also returns a personalized `dashboard` payload: cumulative history trends, recorded session durations, pipeline metrics, assessment history links, topic/category skill scores, and result-based milestones. The dashboard does not synthesize missing scores. Existing records do not track coding-editor wall time, so it reports execution runtime separately and counts measured duration only for MCQ and completed project sessions. MCQ time uses the assessment start/submit timestamps; project interview time uses session start/completion timestamps.

CSRF protection uses a session-bound token returned by `/api/auth/me` and signup/login responses; send it in `X-CSRF-Token` for signup and other state-changing requests. Signup also checks the browser origin in same-site deployment.

## Tests

Backend tests are in `backend/tests/`. Run with `cd backend; pip install -r requirements.txt; pytest`. Frontend production build: `cd frontend; npm install; npm run build`.
