# 모의 외부 서버 (`apps/mocks`)

실제 결제와 실제 문자 발송 없이 **PG(결제대행사)**와 **문자·알림톡 중계사**를 흉내 내는 별도 서버입니다.
api 코드를 import하지 않고 HTTP로만 통신하며, 진짜 외부 서비스처럼 비동기로 웹훅을 보냅니다.

- 포트: `4100` (`MOCKS_PORT`)
- 저장소: 같은 Postgres의 `mock` 스키마(`pg_transactions`, `pg_events`, `relay_messages`). 서버가 뜰 때 테이블을 만듭니다.
- 웹훅 서명: 헤더 `X-Mock-Signature` = 원문 body에 대한 HMAC-SHA256(hex). 비밀키는 `MOCK_PG_WEBHOOK_SECRET`, `MOCK_RELAY_WEBHOOK_SECRET`.
- 실행: 루트에서 `pnpm dev`(web·api와 함께) 또는 `pnpm dev:mocks`(단독)
- 테스트: `pnpm --filter @plandit/mocks test:e2e` (Node 내장 테스트 러너, `plandit_test` DB 사용)

## 모의 PG

| 메서드·경로 | 설명 |
|---|---|
| `POST /pg/v1/payments/reserve` | 결제 준비. body `{ merchantTradeId, amount, returnUrl, webhookUrl? }` → `{ txId, paymentPageUrl }`. 같은 `merchantTradeId`로 다시 부르면 기존 거래를 돌려줌(금액이 다르면 409) |
| `GET /pg/pay/{txId}` | 사용자가 보는 결제 페이지. "결제 승인" / "결제 취소" 버튼 |
| `POST /pg/v1/payments/{txId}/confirm` | 서버에서 승인 요청(결제 페이지의 승인 버튼과 같은 처리). 여러 번 불러도 한 번만 승인 |
| `POST /pg/v1/payments/{txId}/cancel` | 승인된 결제 취소(환불). `CANCELED` 웹훅 전송 |
| `GET /pg/v1/payments/{txId}` | 재조회. 웹훅이 안 오거나 응답이 유실됐을 때 사용 |
| `GET /pg/v1/payments?merchantTradeId=` | 가맹점 주문번호로 재조회(reserve 응답 자체가 유실된 경우) |
| `POST /pg/v1/admin/webhooks/{eventId}/resend` | 웹훅 수동 재전송 |
| `GET /pg/admin` | 최근 거래 50건 목록 페이지 |

웹훅 body: `{ eventId, txId, merchantTradeId, type(APPROVED|FAILED|CANCELED), amount, method, failureCode, occurredAt }`

### 시나리오 (결제 금액의 끝 두 자리)

| 끝자리 | 동작 | 확인하려는 것 |
|---|---|---|
| `00` (그 외 전부) | 정상 승인, 웹훅 1회 | 기본 흐름 |
| `01` | 승인 실패(`CARD_DECLINED`), `FAILED` 웹훅 | 실패 처리 |
| `02` | confirm 응답이 `MOCK_PG_SLOW_MS`(30초) 늦게 옴. 승인 자체는 즉시 기록 | 응답 유실 → 재조회로 확정 |
| `03` | 같은 `eventId`로 웹훅 2회 | 웹훅 중복 수신 |
| `04` | 웹훅이 `MOCK_PG_WEBHOOK_DELAY_MS`(10초) 뒤에 옴 | 리다이렉트가 웹훅보다 먼저 오는 경우 |
| `05` | 웹훅을 보내지 않음 | 웹훅 유실 → 재조회 스케줄러 |

## 모의 문자 중계사

| 메서드·경로 | 설명 |
|---|---|
| `POST /relay/v1/messages` | 발송 접수. body `{ to, body, kind(SMS\|LMS\|ALIMTALK), clientRef?, callbackUrl? }` → `202 { msgId }` |
| `GET /relay/v1/messages/{msgId}` | 결과 재조회 |
| `POST /relay/v1/admin/webhooks/{eventId}/resend` | 결과 웹훅 수동 재전송 |
| `GET /inbox?phone=010-0000-0001` | **가상 수신함**: 그 번호로 "도착"한 문자 목록 |

결과 웹훅 body: `{ eventId, msgId, clientRef, to, status(DELIVERED|FAILED), failCode, occurredAt }`

- 접수 후 `RELAY_DELAY_MS`(3초) 뒤에 결과가 정해집니다.
- 번호 끝자리가 `9`이면 `INVALID_NUMBER`로 실패, 그 외에는 `RELAY_FAIL_RATE`(10%) 확률로 `CARRIER_ERROR`.
- 초당 `RELAY_RPS`(20)건을 넘으면 `429` + `Retry-After: 1`.

## curl로 따라 해보기

아래는 api 없이 모의 서버만으로 전체 흐름을 재현하는 절차입니다. Git Bash 기준입니다.

**0. 웹훅을 받아서 출력할 임시 수신기를 띄웁니다** (새 터미널)

```bash
node -e "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(q.headers['x-mock-signature'],b);s.end()})}).listen(4999)"
```

**1. 모의 서버 실행** (다른 터미널, 저장소 루트)

```bash
pnpm dev:mocks
```

**2. 결제 준비 → 승인 → 웹훅 수신 (시나리오 00)**

```bash
curl -s -X POST localhost:4100/pg/v1/payments/reserve -H 'content-type: application/json' -d '{"merchantTradeId":"DEMO-1","amount":10000,"returnUrl":"http://localhost:3000/credits","webhookUrl":"http://localhost:4999/pg"}'
```

응답의 `txId`로 승인합니다. 브라우저로 `paymentPageUrl`을 열어 "결제 승인"을 눌러도 같습니다.

```bash
curl -s -X POST localhost:4100/pg/v1/payments/<txId>/confirm
```

수신기 터미널에 `<서명> {"eventId":"evt_…","type":"APPROVED",…}`가 한 줄 찍힙니다.

**3. 웹훅 중복 (시나리오 03)**: 금액만 `10003`으로 바꿔 2번을 반복하면 같은 `eventId`가 두 줄 찍힙니다.

**4. 웹훅 유실 (시나리오 05)**: 금액 `10005`로 승인하면 수신기에는 아무것도 오지 않지만, 재조회하면 승인 상태입니다.

```bash
curl -s "localhost:4100/pg/v1/payments?merchantTradeId=DEMO-5"
```

**5. 문자 발송 → 결과 웹훅 → 가상 수신함**

```bash
curl -s -X POST localhost:4100/relay/v1/messages -H 'content-type: application/json' -d '{"to":"010-0000-0001","body":"내일 10시 팀 회의","kind":"SMS","callbackUrl":"http://localhost:4999/relay"}'
```

3초 뒤 수신기에 `"status":"DELIVERED"`가 찍히고, 브라우저에서 http://localhost:4100/inbox?phone=010-0000-0001 을 열면 문자가 보입니다.
번호를 `010-0000-0009`로 바꾸면 `INVALID_NUMBER`로 실패합니다.

> Windows Git Bash에서는 `curl -d`에 쓴 한글이 CP949로 전송되어 깨질 수 있습니다. 한글 본문은 UTF-8로 저장한 JSON 파일을 `--data-binary @msg.json`으로 보내세요.
