import json
import os
import subprocess
import sys
from pathlib import Path

from core import DATA


SCRIPT = '''import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

SPEC = json.loads(__SPEC__)
ROOT = Path(__file__).parent


def locator(page, spec):
    kind, name = spec["kind"], spec["name"]
    if kind == "label":
        return page.get_by_label(name, exact=True)
    if kind == "test_id":
        return page.get_by_test_id(name)
    if kind == "role":
        role, label = name.split("|", 1)
        return page.get_by_role(role, name=label, exact=True)
    return page.locator(name)


def local_url(url):
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}


def block_remote(route):
    if local_url(route.request.url):
        route.continue_()
    else:
        route.abort()


results = []
with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    try:
        for index, case in enumerate(SPEC["plan"]["cases"], 1):
            context = browser.new_context()
            context.route("**/*", block_remote)
            context.tracing.start(screenshots=True, snapshots=True, sources=True)
            page = context.new_page()
            name = f"case-{index:03d}"
            status, error = "passed", ""
            try:
                page.goto(SPEC["url"], wait_until="domcontentloaded", timeout=15000)
                if not local_url(page.url):
                    raise ValueError("외부 주소로 이동했습니다.")
                for step in case["steps"]:
                    target = locator(page, step["locator"])
                    action = step["action"]
                    if action == "fill":
                        target.fill(step["value"], timeout=5000)
                    elif action == "select":
                        target.select_option(label=step["value"], timeout=5000)
                    elif action == "press":
                        target.press(step["value"], timeout=5000)
                    else:
                        target.click(timeout=5000)
                for assertion in case["assertions"]:
                    target = locator(page, assertion["locator"])
                    if assertion["check"] == "visible":
                        expect(target).to_be_visible(timeout=5000)
                    elif assertion["check"] == "hidden":
                        expect(target).to_be_hidden(timeout=5000)
                    elif assertion["check"] == "invalid":
                        assert target.evaluate("el => el.validity && !el.validity.valid"), "입력값이 유효한 상태입니다."
                    elif assertion["check"] == "non_empty":
                        assert target.inner_text(timeout=5000).strip(), "결과 메시지가 비어 있습니다."
                    elif assertion["check"] == "not_text":
                        expect(target).not_to_contain_text(assertion["value"], timeout=5000)
                    elif assertion["check"] == "text":
                        expect(target).to_contain_text(assertion["value"], timeout=5000)
                    else:
                        expect(target).to_have_value(assertion["value"], timeout=5000)
            except Exception as exc:
                status, error = "failed", str(exc)[:2000]
            screenshot = f"{name}-{status}.png"
            try:
                page.screenshot(path=str(ROOT / screenshot), full_page=True, timeout=5000)
            except Exception as exc:
                error += f"; screenshot: {exc}"
                screenshot = ""
            trace = f"{name}-trace.zip" if status == "failed" else ""
            context.tracing.stop(path=str(ROOT / trace) if trace else None)
            context.close()
            results.append({"case_id": case["id"], "title": case["title"], "kind": case["kind"],
                            "status": status, "error": error, "screenshot": screenshot, "trace": trace})
    finally:
        browser.close()
(ROOT / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
'''


def execute(run_id, url, plan):
    directory = DATA / "runs" / run_id
    directory.mkdir(parents=True, exist_ok=True)
    script = directory / "generated_test.py"
    spec = {"url": url, "plan": plan}
    script.write_text(SCRIPT.replace("__SPEC__", repr(json.dumps(spec, ensure_ascii=False))), encoding="utf-8")
    environment = {key: value for key, value in os.environ.items() if key not in {"OPENAI_API_KEY", "POSTGRES_PASSWORD"}}
    try:
        timeout = max(180, 30 * len(plan["cases"]))
        process = subprocess.run([sys.executable, str(script)], cwd=directory, env=environment,
                                 capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"테스트 실행이 {timeout}초를 초과했습니다.") from error
    result_file = directory / "results.json"
    if process.returncode != 0 or not result_file.exists():
        raise RuntimeError((process.stderr or process.stdout or "Playwright 실행 실패")[-2000:])
    return json.loads(result_file.read_text(encoding="utf-8"))
