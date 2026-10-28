# 주문 앱 정책 테스트

## 준비

- 앱: [`examples/order-demo.html`](../examples/order-demo.html)
- 정책 원본: `1.0.0/examples/policies/order-name-v1.json`, `order-name-v2.json`, `order-quantity-v1.json`, `order-amount-v1.json`, `order-note-v1.json`
- 등록 문서: [`v1`](../examples/order-policy-v1.md), [`v2`](../examples/order-policy-v2.md). JSON의 `body` 문구를 그대로 옮겨 각 버전을 5문단으로 등록했다.
- 앱 주소: `http://127.0.0.1:8765/order-demo.html`
- 의도적 결함 주소: `http://127.0.0.1:8765/order-demo.html?bug=name-limit`. v1에서 주문명 21~30자도 저장한다.
- v2 주소: `http://127.0.0.1:8765/order-demo.html?policy=v2`

## 결과

| 검사 | 문서 | 결과 | 실행 ID |
| --- | --- | --- | --- |
| v1 정상 화면의 필수값, 길이, 수량, 재고, 금액, 메모 경계 | v1 | 10개 통과 | `7f2a22e0-0bd0-409a-833d-03888f523085` |
| 주문명 제한을 어기는 화면의 20자 성공, 21자 거절 | v1 | 1개 통과, 1개 실패 | `094fb3f8-ef96-4a3e-a81c-1522a2162925` |
| v2 주문명 30자 성공, 31자 거절 | v2 | 2개 통과 | `39fd42b1-4577-4075-b184-fe1e9629843f` |

실패 건은 21자 주문명이 `저장되었습니다.`로 처리됐다. Common Tester는 기대한 `주문명은 20자 이하여야 합니다.`와 실제 결과를 비교해 실패로 표시했다. [정상 캡처](assets/order-demo-normal.png)와 [결함 캡처](assets/order-demo-bug.png)를 남겼다.

첫 모델 계획은 21자 사례에 11자를 입력하고 단순 요소 표시만 검사해 승인 전에 거절했다. 이후 명세 검증을 강화하고 실제 길이와 기대 메시지가 맞는 계획을 다시 생성했다.

전체 캡처, 생성된 Playwright 코드, 실패 trace는 로컬 `.local/runs/<실행 ID>/`에 있다. `.local/`은 Git에서 제외된다.

## 재실행

API와 화면을 실행한 뒤 루트에서 예제 앱을 띄운다.

```powershell
.\.venv\Scripts\python.exe -m http.server 8765 --bind 127.0.0.1 --directory examples
.\.venv\Scripts\python.exe api\check_order_app.py
```

`http://127.0.0.1:5173`에서 `orders-demo` 문서의 v1 또는 v2를 선택하고 위 앱 주소를 입력한다. 계획을 검토한 후 승인하면 사례별 캡처와 실패 trace를 볼 수 있다.
