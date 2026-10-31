"""Featherless client dedicated to coding assessments (never used by MCQ)."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

MAX_PROVIDER_RETRIES = 2


class CodingAIError(RuntimeError):
    """Safe error from coding assessment AI calls."""


class CodingAIProviderError(CodingAIError):
    def __init__(self, message, status_code=503):
        super().__init__(message)
        self.status_code = status_code


def _provider_config():
    """Load coding-specific settings, falling back only to shared Featherless names."""
    api_key = (os.getenv("CODING_API_KEY") or os.getenv("FEATHERLESS_API_KEY") or "").strip()
    model = (os.getenv("CODING_MODEL") or os.getenv("FEATHERLESS_MODEL") or "").strip()
    base_url = (os.getenv("CODING_API_BASE_URL") or os.getenv("FEATHERLESS_BASE_URL") or
                "https://api.featherless.ai/v1").strip().rstrip("/")
    if not api_key or not model:
        raise CodingAIError("Coding question generation needs CODING_API_KEY and CODING_MODEL (or Featherless fallback settings).")
    if not base_url.startswith("https://"):
        raise CodingAIError("CODING_API_BASE_URL must use HTTPS.")
    return api_key, model, base_url


def request_coding_provider_json(messages, *, max_tokens=5000):
    """Request and parse JSON using coding-only Featherless configuration."""
    api_key, model, base_url = _provider_config()
    url = base_url + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    last_error = None
    for attempt in range(MAX_PROVIDER_RETRIES):
        payload = {"model": model, "messages": messages, "temperature": 0.35,
                   "max_tokens": max_tokens, "response_format": {"type": "json_object"}}
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=(10, 60))
            if response.status_code in (400, 422):
                payload.pop("response_format", None)
                response = requests.post(url, headers=headers, json=payload, timeout=(10, 60))
            if response.status_code == 429 or response.status_code >= 500:
                last_error = CodingAIProviderError(
                    f"The coding AI provider returned HTTP {response.status_code}.", response.status_code)
                if attempt + 1 < MAX_PROVIDER_RETRIES:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise last_error
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            if isinstance(content, list):
                content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
            if not isinstance(content, str) or not content.strip():
                raise CodingAIError("The coding AI provider returned an empty response.")
            return json.loads(content)
        except requests.Timeout as exc:
            last_error = CodingAIProviderError("Coding AI request timed out. Please retry.")
            if attempt + 1 < MAX_PROVIDER_RETRIES:
                continue
            raise last_error from exc
        except requests.ConnectionError as exc:
            last_error = CodingAIProviderError("Could not connect to the coding AI provider.")
            if attempt + 1 < MAX_PROVIDER_RETRIES:
                time.sleep(0.5 * (attempt + 1))
                continue
            raise last_error from exc
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else 503
            raise CodingAIProviderError(f"The coding AI provider rejected the request (HTTP {status}).", status) from exc
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise CodingAIError("The coding AI provider returned invalid JSON or an unsupported response shape.") from exc
    raise last_error or CodingAIError("Coding AI request failed. Please retry.")
