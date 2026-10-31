"""Judge0 adapter. Untrusted source is never executed inside the Flask process."""
from __future__ import annotations

import json
import os
import time
from urllib.parse import urlparse

import requests

MAX_STDOUT_BYTES = 64 * 1024
MAX_DIAGNOSTIC_BYTES = 8 * 1024


def _bounded_text(value, limit):
    """Bound runner output before it reaches logs, API responses, or scoring."""
    text = value if isinstance(value, str) else ""
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= limit:
        return text, False
    clipped = encoded[:limit].decode("utf-8", errors="ignore")
    return clipped, True


class RunnerError(RuntimeError):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


def configured_languages():
    raw = os.getenv("JUDGE0_LANGUAGES", "{}")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RunnerError("JUDGE0_LANGUAGES must be valid JSON configuration.", 503) from exc
    if not isinstance(data, dict):
        raise RunnerError("JUDGE0_LANGUAGES must be a JSON object.", 503)
    languages = {}
    for key, entry in data.items():
        if (not isinstance(key, str) or not key.isidentifier() or not isinstance(entry, dict)
                or type(entry.get("id")) is not int or entry["id"] < 1
                or not isinstance(entry.get("label"), str) or not entry["label"].strip()):
            raise RunnerError("Each configured language needs a safe identifier, numeric Judge0 id, and label.", 503)
        languages[key] = {"id": entry["id"], "label": entry["label"].strip(),
                          "monaco": entry.get("monaco", key)}
    return languages


def _runner_config():
    base = os.getenv("JUDGE0_BASE_URL", "").strip().rstrip("/")
    if not base:
        raise RunnerError("Code execution is not configured. Set up an isolated Judge0 service first.", 503)
    parsed = urlparse(base)
    allow_http = os.getenv("JUDGE0_ALLOW_HTTP", "false").lower() == "true"
    if parsed.scheme != "https" and not (parsed.scheme == "http" and allow_http and parsed.hostname in {"localhost", "127.0.0.1"}):
        raise RunnerError("JUDGE0_BASE_URL must use HTTPS (HTTP is allowed only for localhost development).", 503)
    return base, os.getenv("JUDGE0_API_KEY", "").strip()


def _headers(api_key):
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        headers["X-Auth-Token"] = api_key
    return headers


def execute(source_code, language, stdin, *, limits=None, timeout_seconds=30):
    """Create and poll an isolated Judge0 submission with server-controlled limits."""
    base, api_key = _runner_config()
    languages = configured_languages()
    if not isinstance(language, str) or language not in languages:
        raise RunnerError("That programming language is not enabled.", 400)
    if not isinstance(source_code, str) or not source_code.strip() or len(source_code.encode("utf-8")) > 30_000:
        raise RunnerError("Code must be non-empty and at most 30 KB.", 400)
    if not isinstance(stdin, str) or len(stdin.encode("utf-8")) > 10_000:
        raise RunnerError("Input must be at most 10 KB.", 400)

    limits = limits or {}
    payload = {
        "source_code": source_code,
        "language_id": languages[language]["id"],
        "stdin": stdin,
        "cpu_time_limit": min(max(float(limits.get("cpu_time_limit", 2)), 0.5), 5),
        "cpu_extra_time": 0.5,
        "wall_time_limit": min(max(float(limits.get("wall_time_limit", 6)), 2), 10),
        "memory_limit": min(max(int(limits.get("memory_limit", 128000)), 16000), 256000),
        "stack_limit": 64000,
        "max_processes_and_or_threads": 20,
        "max_file_size": 1024,
        "enable_network": False,
        "number_of_runs": 1,
    }
    try:
        created = requests.post(base + "/submissions", params={"base64_encoded": "false", "wait": "false"},
                                headers=_headers(api_key), json=payload, timeout=(5, 15))
        created.raise_for_status()
        token = created.json().get("token")
        if not isinstance(token, str) or not token:
            raise RunnerError("The code runner did not return a submission token.")
        deadline = time.monotonic() + min(max(float(timeout_seconds), 1), 30)
        while time.monotonic() < deadline:
            response = requests.get(base + "/submissions/" + token,
                                    params={"base64_encoded": "false", "fields": "stdout,stderr,compile_output,message,status,time,memory"},
                                    headers=_headers(api_key), timeout=(5, 15))
            response.raise_for_status()
            result = response.json()
            status = result.get("status") or {}
            status_id = status.get("id")
            if status_id not in (1, 2):
                stdout, stdout_truncated = _bounded_text(result.get("stdout"), MAX_STDOUT_BYTES)
                stderr, _ = _bounded_text(result.get("stderr"), MAX_DIAGNOSTIC_BYTES)
                compile_output, _ = _bounded_text(result.get("compile_output"), MAX_DIAGNOSTIC_BYTES)
                message, _ = _bounded_text(result.get("message"), MAX_DIAGNOSTIC_BYTES)
                return {"status": status.get("description", "Unknown"), "status_id": status_id,
                        "stdout": stdout, "stdout_truncated": stdout_truncated,
                        "stderr": stderr, "compile_output": compile_output, "message": message,
                        "time": result.get("time"), "memory": result.get("memory")}
            time.sleep(0.4)
        raise RunnerError("The isolated code runner timed out while processing this submission.")
    except requests.Timeout as exc:
        raise RunnerError("The isolated code runner timed out. Please retry.") from exc
    except requests.RequestException as exc:
        raise RunnerError("Could not reach the isolated code runner.") from exc
    except (ValueError, TypeError) as exc:
        raise RunnerError("The isolated code runner returned an invalid response.") from exc


def normalized_output(text):
    return "\n".join(line.rstrip() for line in (text or "").replace("\r\n", "\n").split("\n")).strip()


def run_cases(source_code, language, cases, *, include_details=True):
    results = []
    total_time = 0.0
    peak_memory = 0
    try:
        total_budget = min(max(float(os.getenv("CODE_RUN_TOTAL_TIMEOUT_SECONDS", "60")), 10), 180)
    except ValueError:
        total_budget = 60
    deadline = time.monotonic() + total_budget
    for index, case in enumerate(cases, start=1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RunnerError("The total assessment execution budget expired. Please retry later.")
        executed = execute(source_code, language, case.get("input", ""), timeout_seconds=remaining)
        runtime_status = executed["status"]
        accepted = (runtime_status == "Accepted" and not executed.get("stdout_truncated", False)
                    and normalized_output(executed["stdout"]) == normalized_output(case.get("output", "")))
        if runtime_status == "Accepted" and not accepted:
            runtime_status = "Wrong Answer"
        try:
            total_time += float(executed.get("time") or 0) * 1000
        except (TypeError, ValueError):
            pass
        try:
            peak_memory = max(peak_memory, int(executed.get("memory") or 0))
        except (TypeError, ValueError):
            pass
        item = {"case": index, "passed": accepted, "status": runtime_status,
                "time_ms": executed.get("time"), "memory_kb": executed.get("memory")}
        if include_details:
            item.update({"input": case.get("input", ""), "expected_output": case.get("output", ""),
                         "actual_output": executed["stdout"],
                         "error": executed["compile_output"] or executed["stderr"] or executed["message"]})
        results.append(item)
        if runtime_status != "Accepted" and runtime_status != "Wrong Answer":
            # Compile/runtime/resource failures apply to the remaining test cases too.
            results.extend({"case": n, "passed": False, "status": runtime_status, "time_ms": None, "memory_kb": None}
                           for n in range(index + 1, len(cases) + 1))
            break
    return {"results": results, "passed": sum(item["passed"] for item in results), "total": len(cases),
            "score": round(sum(item["passed"] for item in results) / len(cases) * 100, 2) if cases else 0,
            "execution_time_ms": round(total_time, 2), "memory_kb": peak_memory}
