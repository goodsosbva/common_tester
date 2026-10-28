from pathlib import Path
from uuid import UUID

from playwright.sync_api import expect, sync_playwright

from .models import Locator, TestPlan


def find(page, locator: Locator):
    if locator.kind == "role":
        target = page.get_by_role(locator.value, name=locator.name, exact=True)
    elif locator.kind == "label":
        target = page.get_by_label(locator.value, exact=True)
    elif locator.kind == "test_id":
        target = page.get_by_test_id(locator.value)
    else:
        target = page.locator(locator.value)
    target.wait_for(state="attached", timeout=5000)
    count = target.count()
    if count != 1:
        raise ValueError(f"locator matched {count} elements: {locator.kind}={locator.value}")
    return target


def execute(plan: TestPlan, run_id: UUID, base_url: str, artifacts_root: Path) -> dict:
    target_url = base_url.rstrip("/") + plan.route
    fields = {field.id: field.locator for field in plan.fields}
    artifact_dir = artifacts_root / str(run_id)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    results = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for index, case in enumerate(plan.cases, start=1):
                context = browser.new_context()
                context.set_default_timeout(5000)
                context.tracing.start(screenshots=True, snapshots=True, sources=True)
                page = context.new_page()
                result = {"id": case.id, "title": case.title, "status": "passed"}
                try:
                    page.goto(target_url, wait_until="domcontentloaded", timeout=10000)
                    for step in case.steps:
                        target = find(page, fields[step.field_id])
                        if step.action == "fill":
                            target.fill(step.value)
                        elif step.action == "click":
                            target.click()
                        elif step.action == "select":
                            target.select_option(step.value)
                        else:
                            target.press(step.value)
                    for assertion in case.assertions:
                        target = find(page, fields[assertion.field_id])
                        if assertion.action == "visible":
                            expect(target).to_be_visible()
                        elif assertion.action == "value":
                            expect(target).to_have_value(assertion.expected)
                        else:
                            expect(target).to_have_text(assertion.expected)
                except Exception as error:
                    result.update(status="failed", error=str(error)[:2000])
                finally:
                    screenshot = artifact_dir / f"case-{index}.png"
                    try:
                        page.screenshot(path=str(screenshot), full_page=True)
                        result["screenshot"] = str(screenshot)
                    except Exception:
                        pass
                    trace = artifact_dir / f"case-{index}-trace.zip"
                    context.tracing.stop(path=str(trace) if result["status"] == "failed" else None)
                    context.close()
                if result["status"] == "failed":
                    result["trace"] = str(trace)
                results.append(result)
        finally:
            browser.close()

    passed = sum(case["status"] == "passed" for case in results)
    return {
        "status": "passed" if passed == len(results) else "failed",
        "total": len(results),
        "passed": passed,
        "cases": results,
    }
