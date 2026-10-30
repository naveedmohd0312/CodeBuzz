# CodeBuzz

CodeBuzz is an AI-powered, portfolio-driven technical assessment platform. Phase 1 provides candidate registration, email verification, portfolio extraction, authentication, and a candidate dashboard. Assessment experiences are intentionally marked as coming soon.

## Architecture

- `frontend/`: React 19 + Vite single-page application.
- `backend/`: Flask API, SQLAlchemy models, SQLite by default, private uploads under `backend/instance/uploads/`.
- Authentication uses Flask's signed, HTTP-only session cookie. In production, serve the frontend and API from the same site and set `COOKIE_SECURE=true`.
- With email OTP enabled, signup details and the uploaded file are held in a temporary registration for up to 30 minutes; the `User` account is created after a valid OTP. OTP is disabled by default, so signup creates an active account and signs in immediately.

## Requirements

- Node.js 20 or newer and npm.
- Python 3.10 or newer.

## Setup

1. Copy `.env.example` to `.env` and configure `SECRET_KEY`, mail SMTP settings, and OpenRouter settings.
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

See `.env.example`. Email OTP is disabled by default (`EMAIL_OTP_ENABLED=false`): signup activates the candidate and signs them in without sending email. To restore OTP later, set `EMAIL_OTP_ENABLED=true` and configure SMTP. If OpenRouter is unavailable or not configured, the account remains usable and its portfolio shows `failed` with a retry control. Manual portfolio edits remain available.

For Gmail SMTP, set `MAIL_SERVER=smtp.gmail.com`, `MAIL_PORT=587`, and `MAIL_USE_TLS=true`. Use your Gmail address for `MAIL_USERNAME` and `MAIL_DEFAULT_SENDER`, and a Google App Password for `MAIL_PASSWORD` (not your normal Gmail password). Google requires 2-Step Verification for App Passwords; see [Google's App Password help](https://support.google.com/accounts/answer/185833?hl=en-IN). Restart Flask after saving `.env`.

`DATABASE_URL` defaults to `sqlite:///codebuzz.db` in Flask's instance directory. Set `UPLOAD_DIR` to a private, persistent location in deployments. Set `COOKIE_SECURE=true` when serving over HTTPS.

## API

- `POST /api/auth/signup` (multipart form)
- `POST /api/auth/verify-otp`, `POST /api/auth/resend-otp`
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/portfolio`, `POST /api/portfolio/upload`, `POST /api/portfolio/extract`, `POST /api/portfolio/retry-extraction`, `PUT /api/portfolio/update`
- `GET /api/dashboard`

CSRF protection uses a session-bound token returned by `/api/auth/me` and signup/login responses; send it in `X-CSRF-Token` for signup and other state-changing requests. Signup also checks the browser origin in same-site deployment.

## Tests

Backend tests are in `backend/tests/`. Run with `cd backend; pip install -r requirements.txt; pytest`. Frontend production build: `cd frontend; npm install; npm run build`.
