from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


EXAMPLES = Path(__file__).resolve().parent


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(EXAMPLES)))
Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_port}/techup-demo.html"


def valid_member(page):
    page.get_by_label("이메일", exact=True).fill("new@example.com")
    page.get_by_label("닉네임", exact=True).fill("새회원")
    page.get_by_label("비밀번호", exact=True).fill("Abcd1234")
    page.get_by_label("이메일 인증 완료").check()


try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page()

            page.goto(url)
            valid_member(page)
            page.get_by_role("button", name="회원가입").click()
            expect(page.locator("#member-status")).to_have_text("가입되었습니다.")
            page.get_by_role("button", name="회원가입").click()
            expect(page.locator("#member-status")).to_have_text("이미 가입된 이메일입니다.")

            page.goto(url + "?bug=email")
            valid_member(page)
            page.get_by_role("button", name="회원가입").click()
            expect(page.locator("#member-status")).to_have_text("올바른 이메일을 입력해 주세요.")

            page.goto(url)
            page.get_by_label("최대 가격 (원)").fill("50000")
            page.get_by_role("button", name="검색", exact=True).click()
            expect(page.locator("#search-status")).to_have_text("검색 결과: 1개")
            expect(page.locator("#product-list")).to_contain_text("RAM 16GB")

            page.get_by_label("상품 선택").select_option(label="CPU 기본형 (100,000원, 재고 3개)")
            page.get_by_label("담을 수량").fill("4")
            page.get_by_role("button", name="장바구니 담기").click()
            expect(page.locator("#cart-status")).to_have_text("재고가 부족합니다.")
            page.get_by_label("담을 수량").fill("1")
            page.get_by_role("button", name="장바구니 담기").click()
            expect(page.locator("#cart-summary")).to_contain_text("총 1개")

            page.get_by_label("쿠폰 코드").fill("WELCOME10")
            page.get_by_role("button", name="쿠폰 적용").click()
            expect(page.locator("#coupon-status")).to_contain_text("할인 10,000원")
            page.get_by_role("button", name="주문 결제").click()
            expect(page.locator("#order-summary")).to_contain_text("PAID / 결제 금액 90,000원")
            page.get_by_role("button", name="환불 요청").click()
            expect(page.locator("#order-summary")).to_contain_text("REQUESTED_REFUND")
            page.get_by_role("button", name="환불 승인").click()
            expect(page.locator("#refund-status")).to_have_text("관리자만 환불 승인할 수 있습니다.")
            page.get_by_label("현재 권한").select_option(label="관리자")
            page.get_by_role("button", name="환불 승인").click()
            expect(page.locator("#order-summary")).to_contain_text("CANCELED")

            page.goto(url + "?bug=stock")
            page.get_by_label("담을 수량").fill("4")
            page.get_by_role("button", name="장바구니 담기").click()
            expect(page.locator("#cart-status")).to_have_text("장바구니에 담았습니다.")

            page.goto(url)
            page.get_by_label("현재 권한").select_option(label="관리자")
            page.get_by_label("등록 상품명").fill("새 CPU")
            page.get_by_label("등록 카테고리").select_option(label="CPU")
            page.get_by_label("등록 가격 (원)").fill("100000")
            page.get_by_label("상품 이미지 수").fill("6")
            page.get_by_role("button", name="상품 등록").click()
            expect(page.locator("#admin-status")).to_have_text("상품 이미지는 0~5장이어야 합니다.")
            page.get_by_label("상품 이미지 수").fill("5")
            page.get_by_role("button", name="상품 등록").click()
            expect(page.locator("#admin-status")).to_have_text("상품이 등록되었습니다.")
            expect(page.locator("#product-list")).to_contain_text("새 CPU")
        finally:
            browser.close()
    print("techup demo smoke: PASS")
finally:
    server.shutdown()
