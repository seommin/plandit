# 장애 대응 런북

증상 → 확인할 지표·로그 → 복구 명령 → 정상화 확인 순서로 적었습니다. 복구 명령은 모두 **평소 스케줄 작업과 같은 코드**를 지금 한 번 실행하는 것이라, 여러 번 실행해도 결과가 달라지지 않습니다(멱등).

## 준비

- 지표: `GET /metrics` (api, `Authorization: Bearer $METRICS_TOKEN`), 워커는 `WORKER_METRICS_PORT`의 `/metrics`
- 운영자 API: `PLATFORM_ADMIN_EMAILS`에 등록된 계정으로 호출(web 경유 또는 `x-api-secret` + `x-user-id`)
- 추적: 모든 로그 줄과 감사 로그에 `traceId`가 있습니다. 요청은 `X-Trace-Id` 헤더 값, 큐 작업은 작업을 예약한 요청의 값(없으면 `job-<id>`)입니다. 복구 명령을 부를 때 `X-Trace-Id: incident-<번호>`를 붙이면 그 명령이 만든 감사 로그를 나중에 한 번에 찾을 수 있습니다.

아래 예시의 `$API`는 api 주소, `$OP`는 운영자 인증 헤더입니다.

```bash
export API=http://localhost:4000
export OP='-H "x-api-secret: $API_INTERNAL_SECRET" -H "x-user-id: <운영자 userId>"'
```

## 지표 요약

| 지표 | 의미 | 알림 기준(예) |
|---|---|---|
| `plandit_payments_unsettled{status}` | RESERVE·UNKNOWN 결제 수 | UNKNOWN > 0이 10분 이상 |
| `plandit_payments_unsettled_oldest_seconds` | 가장 오래된 미확정 결제의 나이 | > 900초(재조회 최소 대기 5분 + 여유) |
| `plandit_webhook_events_total{source,result}` | 웹훅 처리 결과 | `invalid_signature` 증가, `CONFLICT_STATE`·`AMOUNT_MISMATCH` 1건이라도 |
| `plandit_ledger_appends_total{type,outcome}` | 원장 기록 시도 | `outcome="insufficient"` 급증 |
| `plandit_reminder_deliveries_pending{status}` | 발송 대기(QUEUED)·결과 대기(SENT) | QUEUED가 5분 넘게 줄지 않음 |
| `plandit_queue_jobs{queue,state}` | BullMQ 작업 수 | `waiting` 계속 증가, `failed` 증가 |
| `plandit_jobs_total{queue,name,outcome}` (워커) | 작업 시도 결과 | `failed` 비율 급증(429 재시도도 여기에 잡힘) |
| `plandit_http_requests_total`, `..._duration_seconds` | 라우트 패턴별 요청·지연 | 5xx 비율, p95 지연 |
| `plandit_ai_usages_unsettled{status}` | 선차감을 쥐고 있는 AI 사용 건(RESERVED·CALLING) | CALLING이 `AI_USAGE_STALE_MS`(30분) 넘게 줄지 않음 |
| `plandit_ai_calls_total{provider,outcome}` | LLM 호출 결과(SUCCEEDED 또는 실패 코드) | `LLM_AUTH` 1건이라도, `LLM_OVERLOADED`·`LLM_RATE_LIMITED`·`LLM_TIMEOUT` 비율 급증 |
| `plandit_ai_tokens_total{model,kind}`, `plandit_ai_call_duration_seconds` | 모델별 토큰, 호출 지연(SDK 재시도 포함) | 대체 모델(`claude-opus-5`·`claude-opus-4-8`) 토큰 급증 = 거절이 늘었다는 뜻 |

## A. 미확정 결제가 쌓인다

**증상**: `plandit_payments_unsettled_oldest_seconds`가 계속 증가. 사용자가 "결제했는데 크레딧이 안 들어왔다"고 문의.

**원인 후보**
1. PG 웹훅 유실(모의 PG 시나리오 `05`) 또는 웹훅 서명 실패(→ B)
2. 워커가 멈춰서 재조회 작업이 안 돎: `plandit_queue_jobs{queue="payment-reconcile"}`에 `waiting`이 쌓이거나 워커 `/metrics`가 응답하지 않음
3. PG 장애: 재조회 로그 `Payment reconcile failed`

**확인**
- 결제 목록: `GET /workspaces/:id/payments?order=desc` → `status`, `tradeId`
- PG 기록: `GET <PG>/v1/payments?merchantTradeId=<tradeId>`

**복구**
```bash
# 워커가 죽었으면 먼저 재시작. 그다음(또는 급하면 바로) 재조회를 지금 실행:
curl -X POST "$API/admin/jobs/payment-reconcile?minAgeMs=0" $OP -H "x-trace-id: incident-001"
# → { checked, approved, failed, expired, pending, settled, mismatch, errors }
```
PG가 승인한 건은 웹훅과 **같은 멱등키**(`PAYMENT:{id}:CHARGE`)로 지급되므로, 나중에 웹훅이 뒤늦게 와도 두 번 지급되지 않습니다.

**정상화 확인**: `plandit_payments_unsettled{status="RESERVE"}`가 미결제 건만 남고, 감사 로그 `payment.approved`에 `traceId=incident-001`, `source=reconcile`.

## B. 웹훅 서명 실패가 급증한다

**증상**: `plandit_webhook_events_total{result="invalid_signature"}` 증가. api 응답 401.

**원인 후보**: 배포 후 `MOCK_PG_WEBHOOK_SECRET` / `MOCK_RELAY_WEBHOOK_SECRET` 값 불일치(가장 흔함), 또는 외부에서 위조 요청.

**확인**: PG 쪽 발송 기록의 `last_http_status = 401`(모의 PG `GET /pg/admin`). 출처 IP가 PG가 아니면 위조 → 프록시에서 `/webhooks/*`를 PG 대역만 허용.

**복구**: 시크릿을 맞추고 api 재시작 → 유실된 이벤트는 PG 재전송(`POST <PG>/v1/admin/webhooks/{eventId}/resend`) 또는 A의 재조회로 확정. 서명 실패 요청은 아무것도 저장하지 않았으므로 되돌릴 데이터는 없습니다.

## C. `CONFLICT_STATE` / `AMOUNT_MISMATCH` 웹훅

사람의 판단이 필요한 유일한 경우입니다.

- `CONFLICT_STATE`: 우리가 이미 닫은 결제(만료 `EXPIRED` 등)에 PG 승인이 도착 → **돈은 빠졌는데 크레딧은 없음**. PG에서 결제를 취소(환불)하거나, 사용자와 합의 후 운영자 수동 조정:
  ```bash
  curl -X POST "$API/admin/workspaces/<workspaceId>/credits/adjustments" $OP \
    -H "idempotency-key: incident-001-adjust" -H "content-type: application/json" \
    -d '{"amount": 1000, "memo": "결제 P260928-000123 만료 후 승인분 지급 (incident-001)"}'
  ```
- `AMOUNT_MISMATCH`: 웹훅 금액이 우리 기록과 다름 → 절대 자동 지급하지 않습니다. PG와 거래 내역 대조 후 결정.

## D. 리마인더가 늦게 가거나 쌓인다

**증상**: `plandit_reminder_deliveries_pending{status="QUEUED"}` 또는 `plandit_queue_jobs{queue="reminders",state="waiting"}` 증가.

**원인 후보**
1. 중계사 초당 제한(429) → `plandit_jobs_total{name="send",outcome="failed"}` 증가, 로그 `Carrier answered 429`. 재시도는 지수 백오프 + 지터로 자동 진행
2. 워커 중단 또는 처리량 부족

**복구**: 워커 재시작·추가(여러 대를 띄워도 발송 건은 1회만 처리), `REMINDER_SEND_CONCURRENCY` 조정. 최종 실패한 건은 자동으로 FAILED + 환불됩니다.

**결과가 안 오는 발송(SENT 적체)**: 중계사 결과 웹훅이 유실된 경우입니다.
```bash
curl -X POST "$API/admin/jobs/reminder-reconcile?minAgeMs=0" $OP -H "x-trace-id: incident-002"
```
중계사 기록으로 DELIVERED/FAILED를 확정하고, 실패 건은 `REMINDER_DELIVERY:{id}:REFUND` 키로 한 번만 환불합니다.

## E. 잔액과 원장이 맞지 않는다

정상 경로로는 생길 수 없습니다(잔액은 `LedgerService.append()`만 바꾸고, 원장은 DB 트리거로 수정·삭제가 막혀 있음). 발생했다면 **누가 `CreditAccount`를 직접 UPDATE했는지**부터 찾습니다.

**확인**
```sql
SELECT a.id, a.balance, COALESCE(SUM(l.amount), 0) AS ledger_sum
FROM "CreditAccount" a LEFT JOIN "CreditLedger" l ON l."accountId" = a.id
GROUP BY a.id HAVING a.balance <> COALESCE(SUM(l.amount), 0);
```

**복구**: 원장 합계로 캐시를 다시 계산합니다(원장은 건드리지 않음).
```bash
curl -X POST "$API/admin/credit-accounts/<accountId>/recalculate" $OP
# → { before, after }
```

## F. 잔액 부족이 급증한다

`plandit_ledger_appends_total{outcome="insufficient"}` 증가. 장애는 아니지만, 유료 리마인더가 SKIPPED(`INSUFFICIENT_CREDITS`)로 바뀌고 푸시로 대체 발송되는 중입니다(`fallback` 컬럼). 워크스페이스 관리자에게 충전 안내.

## G. AI 사용 건이 정산되지 않는다

**증상**: `plandit_ai_usages_unsettled{status="CALLING"}`이 줄지 않거나, 사용자가 "AI가 실패했는데 크레딧이 빠졌다"고 문의. 선차감(DEBIT)은 호출 전에 나가므로, 정산·환불 전까지는 잔액이 최대 금액만큼 줄어 있는 것이 정상입니다.

**원인 후보**
1. 워커가 호출 도중 죽었거나 재시작됨: 행은 CALLING으로 남는다
2. 모델 응답이 모든 타임아웃·재시도보다 오래 걸림(`plandit_ai_call_duration_seconds` 상단 버킷)
3. 정리 작업이 안 돎: `plandit_queue_jobs{queue="ai-usage-reconcile"}`에 `waiting`이 쌓임

**확인**
- 사용 내역: `GET /workspaces/:id/ai-usages?status=CALLING` → `startedAt`, `estimatedCredits`
- 실패 코드 분포: `GET /workspaces/:id/ai-usages?status=FAILED` → `failureCode`. `LLM_AUTH`면 키 문제(`ANTHROPIC_API_KEY`. 키가 아예 비어 있으면 `LLM_ERROR`로 잡히고 기동 로그에 경고가 남는다), `LLM_REFUSED`면 대체 모델까지 거절한 것

**복구**
```bash
# 멈춘 건을 지금 정리(기본 기준은 AI_USAGE_STALE_MS, 급하면 minAgeMs로 낮춘다. 0은 진행 중인 호출까지 닫으니 주의)
curl -X POST "$API/admin/jobs/ai-usage-reconcile?minAgeMs=600000" $OP -H "x-trace-id: incident-001"
# → { checked, refunded, errors }
```
사용 건 단위 멱등키(`AI_USAGE:{id}:REFUND`)라 여러 번 실행해도 환불은 한 번입니다. 정리한 뒤에 모델 응답이 돌아와도 행이 CALLING이 아니므로 청구하지 않습니다(로그 `Late LLM reply`).

**정상화 확인**: `plandit_ai_usages_unsettled`가 진행 중인 호출만 남고, 해당 사용 건이 `FAILED`·`failureCode=STALE`·`refundLedgerId` 있음. 원장에서 그 건의 `DEBIT + REFUND = 0`.

**여행 초안이 "만드는 중"에서 넘어가지 않을 때**도 같은 명령이에요. 초안(`TripPlan`)은 자기 AI 사용 건을 따라가서, 사용 건이 정리되면 같은 트랜잭션에서 `FAILED`(`STALE`)로 바뀌고 화면에는 "다시 만들기"가 나와요. 초안이 GENERATING인데 사용 건이 아직 RESERVED라면 생성 작업이 큐에 없는 것이니 `plandit_queue_jobs{queue="trip-plans"}`와 워커 로그 `Trip plan job failed`를 먼저 봐요.
