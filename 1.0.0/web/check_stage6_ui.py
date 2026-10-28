import json
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
plan = json.loads((ROOT / "examples" / "normal-plan.json").read_text(encoding="utf-8"))
policy = json.loads((ROOT / "examples" / "policies" / "order-name-v1.json").read_text(encoding="utf-8"))
runs = {}
calls = []


def handle(route):
    path = unquote(urlparse(route.request.url).path)
    method = route.request.method
    calls.append((method, path))
    if path == "/api/runs" and method == "GET":
        route.fulfill(json=[{key: run[key] for key in (
            "id", "project_id", "route", "policy_version", "status", "created_at",
        )} for run in reversed(list(runs.values()))])
    elif path == "/api/demo/setup" and method == "POST":
        route.fulfill(json={"chunk_count": 1})
    elif path == "/api/runs" and method == "POST":
        number = len(runs) + 1
        payload = route.request.post_data_json
        run = {
            **payload, "id": f"00000000-0000-4000-8000-{number:012d}",
            "status": "created", "created_at": "2026-10-25T12:00:00+09:00",
            "plan": None, "result": None, "generation": None, "workflow": None,
        }
        runs[run["id"]] = run
        route.fulfill(status=201, json=run)
    elif path.startswith("/api/runs/") and path.endswith("/workflow/start") and method == "POST":
        run = runs[path.split("/")[3]]
        run.update(status="awaiting_review", plan=plan, result=None,
                   generation={"objective": route.request.post_data_json["objective"], "attempts": [{}]},
                   workflow={"phase": "awaiting_review", "attempts": 1})
        route.fulfill(json=run)
    elif path.startswith("/api/runs/") and path.endswith("/workflow/resume") and method == "POST":
        run = runs[path.split("/")[3]]
        approved = route.request.post_data_json["approved"]
        run["status"] = "passed" if approved else "rejected"
        run["workflow"] = {"phase": "completed" if approved else "rejected", "attempts": 1}
        if approved:
            run["result"] = {"status": "passed", "total": 2, "passed": 2,
                             "cases": [{"id": item["id"], "status": "passed"} for item in plan["cases"]]}
        route.fulfill(json=run)
    elif path.startswith("/api/runs/") and method == "GET":
        route.fulfill(json=runs[path.split("/")[3]])
    elif path.startswith("/api/policies/sources/") and method == "GET":
        route.fulfill(json={"source_id": path.rsplit("/", 1)[-1], "title": policy["title"],
                            "version": policy["version"], "content": policy["body"]})
    else:
        route.fulfill(status=404, json={"detail": "Unexpected mock route"})


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
    page.route("**/api/**", handle)
    page.goto("http://127.0.0.1:5173", wait_until="networkidle")
    page.get_by_role("button", name="실행 생성").click()
    expect(page.get_by_role("button", name="계획 생성")).to_be_visible()
    page.get_by_role("button", name="계획 생성").click()
    expect(page.get_by_role("heading", name="실행계획")).to_be_visible()
    expect(page.get_by_text(policy["body"]).first).to_be_visible()
    expect(page.get_by_role("button", name="승인하고 실행")).to_be_enabled()
    page.get_by_role("button", name="승인하고 실행").click()
    expect(page.get_by_text("2건 중 2건 통과")).to_be_visible()
    page.screenshot(path=str(ROOT / ".local" / "stage6-ui-desktop.png"), full_page=True)

    page.get_by_role("button", name="실행 생성").click()
    page.get_by_role("button", name="계획 생성").click()
    expect(page.get_by_role("button", name="계획 거절")).to_be_visible()
    page.get_by_role("button", name="계획 거절").click()
    expect(page.get_by_text("계획을 거절했습니다. 브라우저 검사는 실행하지 않았습니다.")).to_be_visible()

    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=str(ROOT / ".local" / "stage6-ui-mobile.png"), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    browser.close()

assert ("POST", "/api/demo/setup") in calls
assert sum(path.endswith("/workflow/start") for _, path in calls) == 2
assert sum(path.endswith("/workflow/resume") for _, path in calls) == 2
print("화면에서 실행 생성, 계획과 정책 원문 검토, 승인 결과, 거절, 모바일 폭 확인")
