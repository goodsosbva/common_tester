import json
import hashlib
import base64
import os
import re
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from target_url import validate_target_url
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]


def run_folder(run_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("실행 ID 형식이 올바르지 않습니다.")
    folder = ROOT / ".local" / "runs" / run_id
    if not folder.is_dir() or not folder.resolve().is_relative_to((ROOT / ".local" / "runs").resolve()):
        raise FileNotFoundError("실행 폴더를 찾지 못했습니다.")
    return folder


def execution_folder(run_id: str, execution_id: str) -> Path:
    parent = run_folder(run_id) / "executions"
    if not re.fullmatch(r"[a-f0-9]{32}", execution_id):
        raise ValueError("점검 ID 형식이 올바르지 않습니다.")
    folder = parent / execution_id
    if not folder.is_dir() or not folder.resolve().is_relative_to(parent.resolve()):
        raise FileNotFoundError("점검 결과를 찾지 못했습니다.")
    return folder


def _specs(suite: dict):
    yield from suite.get("specs", [])
    for child in suite.get("suites", []):
        yield from _specs(child)


def run_playwright(run_id: str, target_url: str | None = None) -> dict:
    folder = run_folder(run_id)
    spec = json.loads((folder / "test-spec.json").read_text(encoding="utf-8"))
    target = validate_target_url(target_url or spec["target_url"])
    generated = folder / "generated-tests"
    files = list(generated.glob("*.spec.ts"))
    scenarios = {
        scenario["scenario_key"]: {**scenario, "requirement_key": req["requirement_key"]}
        for req in spec["requirements"] for scenario in req["scenarios"]
    }
    coverage_path = generated / "coverage.json"
    coverage = json.loads(coverage_path.read_text(encoding="utf-8"))["scenarios"] if coverage_path.is_file() else []
    reasons = {item["scenario_key"]: item.get("reason", "") for item in coverage if item["status"] == "unsupported"}
    if not files and (not scenarios or len(coverage) != len(scenarios) or {item["scenario_key"] for item in coverage} != set(scenarios) or any(item["status"] != "unsupported" or not item.get("reason", "").strip() for item in coverage)):
        raise ValueError("실행할 Playwright 파일이 없습니다.")
    execution_id = uuid.uuid4().hex
    output = folder / "executions" / execution_id
    output.mkdir(parents=True, exist_ok=False)
    snapshots = output / "test-source"
    snapshots.mkdir()
    sources = []
    for file in sorted(generated.glob("*.spec.ts")):
        shutil.copyfile(file, snapshots / file.name)
        sources.append({"file": file.name, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
    for file in (generated / "observations.json", ROOT / "playwright-observations.ts"):
        if file.is_file():
            shutil.copyfile(file, snapshots / file.name)
            sources.append({"file": file.name, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
    record = {
        "run_id": run_id, "execution_id": execution_id, "target_url": target,
        "started_at": datetime.now(timezone.utc).isoformat(), "status": "running",
        "cases": [], "unexecuted": [], "error": None,
        "test_sources": sources,
        "test_spec_sha256": hashlib.sha256((folder / "test-spec.json").read_bytes()).hexdigest(),
    }
    if files:
        try:
            with urlopen(target, timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError(f"대상 앱 응답이 200이 아닙니다: {response.status}")
            node = shutil.which("node.exe") or shutil.which("node")
            if not node:
                raise RuntimeError("Node.js 실행 파일이 없습니다.")
            env = os.environ.copy()
            env.pop("OPENAI_API_KEY", None)
            env.update({
                "COMMON_TESTER_TEST_DIR": str(generated),
                "COMMON_TESTER_OUTPUT_DIR": str(output / "test-results"),
                "COMMON_TESTER_REPORT": str(output / "playwright-results.json"),
                "COMMON_TESTER_TARGET_URL": target,
                "COMMON_TESTER_OBSERVATIONS": str(generated / "observations.json") if (generated / "observations.json").is_file() else "",
            })
            command = [node, str(ROOT / "node_modules" / "@playwright" / "test" / "cli.js"), "test", "--config", str(ROOT / "playwright.config.ts")]
            result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", timeout=300)
            (output / "playwright.log").write_text(result.stdout + result.stderr, encoding="utf-8")
            record["exit_code"] = result.returncode
            report_path = output / "playwright-results.json"
            if not report_path.is_file():
                raise RuntimeError("Playwright JSON 보고서가 없습니다. playwright.log를 확인하십시오.")
            report = json.loads(report_path.read_text(encoding="utf-8"))
            if report.get("errors"):
                raise RuntimeError("; ".join(error.get("message", str(error)) for error in report["errors"]))
            for suite in report.get("suites", []):
                for case in _specs(suite):
                    scenario_key = case["title"].split(" ", 1)[0]
                    if scenario_key not in scenarios:
                        raise RuntimeError("명세에 없는 테스트가 실행됐습니다: " + case["title"])
                    source = scenarios[scenario_key]
                    for test in case.get("tests", []):
                        result_data = (test.get("results") or [{}])[-1]
                        status = result_data.get("status", "skipped")
                        screenshots = []
                        traces = []
                        observation = None
                        observation_error = None
                        for attachment in result_data.get("attachments", []):
                            if attachment.get("name") == "common-tester-observation":
                                try:
                                    data = json.loads(base64.b64decode(attachment.get("body", "")))
                                    if data.get("scenario_key") != scenario_key or data.get("actual_policy") not in {"allow", "deny", "unknown"}:
                                        raise ValueError("관찰 결과의 상황 또는 정책 값이 올바르지 않습니다.")
                                    observation = data
                                except (ValueError, TypeError) as error:
                                    observation_error = str(error)
                                continue
                            if not attachment.get("path"):
                                continue
                            file = Path(attachment["path"]).resolve()
                            if not file.is_file() or not file.is_relative_to(output.resolve()):
                                raise RuntimeError("실행 폴더 밖의 첨부 파일 경로가 반환됐습니다.")
                            relative = file.relative_to(output.resolve()).as_posix()
                            if attachment.get("contentType", "").startswith("image/"):
                                screenshots.append(relative)
                            elif attachment.get("name") == "trace":
                                traces.append(relative)
                        record["cases"].append({
                            "scenario_key": scenario_key, "title": case["title"],
                            "requirement_key": source["requirement_key"],
                            "expected_policy": source["expected_policy"],
                            "expected_observation": source["expected_observation"],
                            "source_refs": source["source_refs"], "status": status,
                            "duration_ms": result_data.get("duration", 0),
                            "observation": observation, "observation_error": observation_error,
                            "errors": result_data.get("errors", []),
                            "screenshots": screenshots, "traces": traces,
                            "capture_error": "스크린샷이 남지 않았습니다." if status in {"passed", "failed", "timedOut"} and not screenshots else None,
                        })
            if not record["cases"] or result.returncode not in {0, 1}:
                raise RuntimeError("Playwright 런처가 정상적인 테스트 결과를 반환하지 않았습니다.")
            record["status"] = "completed"
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
            record["status"] = "execution_error"
            record["error"] = str(error)
            (output / "launch-error.txt").write_text(str(error), encoding="utf-8")
    else:
        record["status"] = "not_run"
    executed = {case["scenario_key"] for case in record["cases"]}
    record["unexecuted"] = [
        {"scenario_key": key, "reason": reasons.get(key) or "이번 실행에서 테스트 결과가 생성되지 않았습니다."}
        for key in scenarios if key not in executed
    ]
    record["counts"] = {
        "total": len(record["cases"]),
        "passed": sum(case["status"] == "passed" for case in record["cases"]),
        "failed": sum(case["status"] in {"failed", "timedOut"} for case in record["cases"]),
        "skipped": sum(case["status"] == "skipped" for case in record["cases"]),
        "screenshots": sum(len(case["screenshots"]) for case in record["cases"]),
        "capture_errors": sum(case["capture_error"] is not None for case in record["cases"]),
        "unexecuted": len(record["unexecuted"]),
    }
    failed_cases = [case for case in record["cases"] if case["status"] in {"failed", "timedOut"}]
    (output / "failures.json").write_text(json.dumps(failed_cases, ensure_ascii=False, indent=2), encoding="utf-8")
    record["failure_report"] = "failures.json"
    record["finished_at"] = datetime.now(timezone.utc).isoformat()
    (output / "execution.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return record
