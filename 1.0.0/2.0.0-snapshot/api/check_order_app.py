from playwright.sync_api import sync_playwright


URL = "http://127.0.0.1:8765/order-demo.html"


def check(page, *, url=URL, name="정상 주문", quantity="1", amount="0", note="", expected="저장되었습니다."):
    page.goto(url)
    page.get_by_label("주문명").fill(name)
    page.get_by_label("주문 수량").fill(quantity)
    page.get_by_label("요청 금액 (원)").fill(amount)
    page.get_by_label("주문 메모").fill(note)
    page.get_by_role("button", name="저장").click()
    actual = page.get_by_test_id("feedback").inner_text()
    assert actual == expected, (url, name, quantity, amount, len(note), actual, expected)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page()
    check(page, name="가" * 20, quantity="10", amount="0", note="메" * 200)
    check(page, name="", expected="주문명을 입력해 주세요.")
    check(page, name="가" * 21, expected="주문명은 20자 이하여야 합니다.")
    check(page, quantity="0", expected="주문 수량은 1부터 99까지의 정수여야 합니다.")
    check(page, quantity="11", expected="재고가 부족합니다.")
    check(page, amount="-1", expected="요청 금액은 0 이상의 정수여야 합니다.")
    check(page, note="메" * 201, expected="주문 메모는 200자 이하여야 합니다.")
    check(page, url=URL + "?policy=v2", name="가" * 30)
    check(page, url=URL + "?policy=v2", name="가" * 31, expected="주문명은 30자 이하여야 합니다.")
    check(page, url=URL + "?bug=name-limit", name="가" * 21)
    browser.close()
print("order app policy cases: 10 PASS (last case confirms intentional bug)")
