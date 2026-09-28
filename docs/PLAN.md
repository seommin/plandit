# Plandit 확장 작업 계획

목표: 타임리 백엔드 포지션(TypeScript/NestJS, PostgreSQL/Prisma, Redis/Queue, 크레딧·결제·권한, LLM/RAG/Tool Calling) 지원용 포트폴리오.
기존 캘린더 제품(62커밋) 위에 백엔드 깊이를 얹는다. **1주차가 끝나면 지원하고, 2·3주차는 지원 후 이어 붙인다.**

이슈 하나 = 브랜치 하나(`feat/PLANDIT-<번호>-<요약>`). 완료 조건을 전부 만족하고 `lint / typecheck / test / test:e2e`가 통과하면 체크한다.
우선순위: **M**(must, 1주차 필수) / **S**(should, 시간 되면).

---

## 설계 결정 (ADR 요약)

1. **원장 append-only, 잔액은 캐시.** 모든 변동은 `credit_ledger` 행이고 `balance_after`를 남긴다. 캐시가 어긋나면 원장 합계로 재계산한다.
2. **외부 호출 전 선기록(RESERVE/QUEUED).** 응답 유실 시 "어디까지 진행됐는지 모르는 거래"를 만들지 않는다. 유실 건은 스케줄러가 재조회로 확정한다.
3. **웹훅 멱등 = 이벤트 ID 유니크 + 원장 멱등키.** 두 겹으로 막는다. 이벤트 저장과 원장 반영은 한 트랜잭션.
4. **모의 외부 서버는 별도 앱 하나(`apps/mocks`).** 코드 안에서 가짜 응답을 리턴하면 비동기 콜백·지연·중복을 재현할 수 없다. PG와 중계사는 `/pg/*`, `/relay/*` 경로로 나눈 한 프로세스(무료 호스팅 메모리 절약). api 코드는 import하지 않는다.
5. **외부 연동은 어댑터 인터페이스.** `PaymentGateway`, `MessageProvider`, `LlmClient`, 기존 `PushProviderClient`.
6. **크레딧은 정수.** 푸시 리마인더 0, 문자(SMS) 1, 알림톡 1, LMS 3(설정값). AI 기능은 토큰 기준 환산표.
7. **과금 주체는 워크스페이스.** 가입 시 개인 워크스페이스를 자동 생성하고, 모든 캘린더는 워크스페이스 하나에 속한다(기존 캘린더는 OWNER의 개인 워크스페이스로 백필). 팀은 워크스페이스를 추가로 만들어 멤버를 초대한다.
8. **워커는 api와 같은 코드베이스, 다른 진입점.** `apps/api/src/worker.ts`가 BullMQ 프로세서만 띄운다. 서비스 코드를 패키지로 쪼개지 않고 공유한다.
9. **인증은 기존 Auth.js 유지.** web → api 내부 호출(`x-api-secret`, `x-user-id`) 구조를 바꾸지 않는다. 외부 진입(웹훅)만 `@Public()` + 서명 검증.

---

## 1주차 — 기반·돈·큐

### PLANDIT-1 · 백엔드 기반 정비 [M]
- [ ] `docker-compose.yml`: postgres를 `pgvector/pgvector:pg18`로, redis 7 추가(헬스체크). 기존 web·api 서비스는 유지
- [ ] api: ESLint + Prettier, Jest 단위/e2e 설정 분리, 루트 스크립트 `lint / test / test:e2e`
- [ ] Swagger(`/docs`): zod 스키마 → OpenAPI 변환 방식 확정(`z.toJSONSchema` 또는 `nestjs-zod`)
- [ ] `ApiError` + `ErrorCode` + 전역 ExceptionFilter, 요청별 `traceId`(`X-Trace-Id` 수용/생성), 구조화 로그(pino)
- [ ] `@Public()` 데코레이터(InternalApiGuard 우회), `/health`(DB·Redis 핑)
- [ ] web의 오류 표시가 새 응답 형식(`message`)과 맞는지 확인
- **완료 조건**: `docker compose up -d postgres redis` → `pnpm dev`로 web·api가 뜨고 `/health` 200, `/docs` 표시. 잘못된 입력 → 400에 필드별 details와 traceId

### PLANDIT-2 · 워크스페이스·역할 [M]
- [ ] `workspaces`, `workspace_members` 테이블. 가입 시 개인 워크스페이스(OWNER) + `credit_accounts` 같은 트랜잭션에서 생성
- [ ] 마이그레이션: 기존 사용자마다 개인 워크스페이스·크레딧 계정 생성, 기존 캘린더를 OWNER의 개인 워크스페이스에 연결(`calendars.workspace_id` NOT NULL까지)
- [ ] 워크스페이스 CRUD, 멤버 초대(기존 사용자 이메일)·역할 변경·제거. ADMIN 이상만, 자기 역할 이하로만, 본인 역할 변경 불가
- [ ] `WorkspaceRole.covers()`, `@Roles()` + `RolesGuard`(경로 `/workspaces/:workspaceId/...`)
- [ ] 캘린더 생성 시 워크스페이스 지정(기본값: 개인 워크스페이스)
- **완료 조건**: e2e — MEMBER가 역할 변경 시도 403, ADMIN이 OWNER 부여 시도 403, 비멤버가 워크스페이스 조회 404. 마이그레이션 후 기존 캘린더가 전부 워크스페이스에 연결됨

### PLANDIT-3 · 크레딧 계정·원장 [M]
- [ ] `LedgerService.append({ accountId, type, amount, refType, refId, idempotencyKey, memo })`
  - 트랜잭션 안에서 `credit_accounts` 행 `FOR UPDATE` → 원장 INSERT(`balance_after`) → 캐시 갱신
  - DEBIT 잔액 부족 → `INSUFFICIENT_CREDITS`, 원장에 아무것도 남기지 않음
  - 같은 `idempotencyKey` 재호출 → 기존 행 반환, 부작용 없음
- [ ] `credit_ledger` UPDATE/DELETE 차단 트리거(SQL 마이그레이션)
- [ ] 잔액 조회, 원장 조회(cursor, type 필터), 관리자 수동 조정(ADJUST, memo 필수, 감사 로그)
- [ ] `LedgerService.recalculate(accountId)`
- **완료 조건**:
  - 단위: 잔액 계산, 부족 시 거부, 멱등 재호출
  - e2e: 동시 DEBIT 50개(잔액 30) → 정확히 30개 성공, 원장 30행, `balance_after` 단조 감소, 캐시 = 원장 합계

### PLANDIT-4 · 모의 외부 서버 (`apps/mocks`) [M]
- PG (`/pg`)
  - [ ] `POST /pg/v1/payments/reserve`(merchantTradeId, amount, returnUrl) → `txId`, `paymentPageUrl`
  - [ ] 결제 페이지(단순 HTML) "승인"/"취소". 승인 시 returnUrl 리다이렉트 + **비동기 웹훅**
  - [ ] `POST …/{txId}/confirm`, `POST …/{txId}/cancel`, `GET …/{txId}`(재조회)
  - [ ] 웹훅 body `{ eventId, txId, merchantTradeId, type, amount, method, occurredAt }`, 헤더 `X-Mock-Signature: HMAC-SHA256(secret, rawBody)`
  - [ ] 시나리오(금액 끝 두 자리): `00` 정상 / `01` 승인 실패 / `02` confirm 30초 지연 / `03` 웹훅 2회(같은 eventId) / `04` 웹훅 10초 지연 / `05` 웹훅 안 보냄
- 중계사 (`/relay`)
  - [ ] `POST /relay/v1/messages`(to, body, kind) → 즉시 `msgId` 접수, N초 뒤 결과 웹훅(DELIVERED/FAILED)
  - [ ] 시나리오: 수신번호 끝자리 `9` → 번호 오류 실패. 환경변수 `RELAY_FAIL_RATE`, `RELAY_DELAY_MS`, `RELAY_RPS`(초과 시 429)
  - [ ] **가상 수신함** 페이지: 전화번호별 받은 문자 목록
- [ ] `mock_pg_transactions`, `mock_relay_messages` 테이블(`mock` 스키마), `POST /…/admin/webhooks/{eventId}/resend`
- **완료 조건**: curl만으로 reserve→confirm→웹훅, 문자 접수→결과 웹훅을 재현하는 절차가 `apps/mocks/README.md`에 있다

### PLANDIT-5 · 충전 흐름 [M]
- [ ] `PaymentGateway` + `MockPgAdapter`(`PAYMENT_PROVIDER=mock`)
- [ ] `POST /workspaces/:id/payments/charge` { amount }(ADMIN 이상) → **`payments` RESERVE 저장(trade_id 발급)** → PG reserve → `paymentPageUrl`. PG 호출 실패 시 FAILED
- [ ] returnUrl은 화면용. **원장 반영은 웹훅에서만**
- [ ] `POST /webhooks/payments/mock`(@Public): 서명 검증 → `payment_events` INSERT(event_id unique, 중복이면 200 종료) → 상태 전이 검증(RESERVE/UNKNOWN → APPROVED) → `LedgerService.append(CHARGE, "PAYMENT:{id}:CHARGE")` → payments APPROVED. **한 트랜잭션**
- [ ] 감사 로그 `payment.approved`, `payment.failed`
- **완료 조건**: e2e — 정상(원장 1행, APPROVED) / 시나리오 `03` 중복(이벤트 1행, 원장 1행) / 잘못된 서명 401·변화 없음 / 다른 eventId로 APPROVED 재수신 → 이벤트 저장, 원장 1행 유지

### PLANDIT-6 · 미확정 결제 재조회 (worker) [M]
- [ ] `apps/api/src/worker.ts` 진입점 + BullMQ 반복 작업(1분): RESERVE 5분 경과·UNKNOWN 건을 PG 재조회로 확정, 승인이면 PLANDIT-5 승인 처리를 **같은 멱등키로** 호출
- [ ] 24시간 미확정 → FAILED + 감사 로그
- **완료 조건**: e2e — 시나리오 `05` 충전 → 작업 강제 실행 → APPROVED, 원장 1행. 이후 늦은 웹훅에도 원장 1행

### PLANDIT-7 · 리마인더 발송 큐 [M]
- [ ] `event_reminders`(event_id, minutes_before, channel PUSH/SMS/ALIMTALK, recipient 범위) + 사용자 `phone`
- [ ] 일정 생성·수정·삭제 시 BullMQ **지연 작업** 등록·교체·취소. jobId = `reminder:{reminderId}:{startsAt epoch}`(시각이 바뀌면 새 jobId → 옛 작업은 실행 시 버전 불일치로 무시)
- [ ] 실행: 수신자별 `reminder_deliveries` **QUEUED 선기록**(unique(reminder_id, user_id, fire_at)) → 채널별 발송
  - PUSH: 기존 `PushProviderClient`, 크레딧 0
  - SMS/ALIMTALK: `LedgerService.append(DEBIT, "REMINDER_DELIVERY:{id}:DEBIT")` → `MessageProvider`(mock relay) 호출 → SENT. 잔액 부족이면 SKIPPED(원장 없음) + 푸시로 대체 발송
- [ ] 중계사 결과 웹훅(@Public): `relay_events` 멱등 → DELIVERED/FAILED → 실패 건 **자동 환불**(REFUND, `"REMINDER_DELIVERY:{id}:REFUND"`)
- [ ] 429/5xx 지수 백오프(BullMQ attempts/backoff), 워커 동시성 설정
- [ ] 미확정(SENT 후 N분 결과 없음) 재조회 반복 작업
- **완료 조건**:
  - 단위: 발송 시각 계산(타임존·종일 일정)
  - e2e: 일정 시간 변경 → 옛 시각 발송 0건 / 결과 웹훅 2회 → 환불 1행 / 실패율 30%로 100건 → `차감 = 성공 차감 + 실패 환불`, 이중 환불 0건

### PLANDIT-8 · 감사 로그 [M]
- [ ] `AuditService.record()`: 워크스페이스 멤버 초대·역할 변경·제거, 결제 승인/실패/취소, 수동 조정
- [ ] 조회 API(ADMIN 이상, cursor, action 필터)
- **완료 조건**: PLANDIT-2·5의 e2e에서 감사 로그 행 수를 함께 검증

### PLANDIT-9 · 모바일 우선 UI 전면 개편 [M]
모바일이 주 화면, PC는 같은 컴포넌트를 넓게 펼친 보조 화면.
- [ ] 디자인 토큰(색·간격·타이포·라운드·그림자, 라이트/다크)을 `globals.css` 변수로 정리. 폰트 Pretendard 유지
- [ ] `calendar-app.tsx`(2,800줄 단일 파일)를 화면·컴포넌트 단위로 분리
- [ ] 모바일(< 768px): 하단 탭 바(캘린더 / 일정 / 크레딧 / 설정), 월간 달력 + 선택일 일정 리스트, 일정 작성·편집은 바텀시트, 44px 이상 터치 영역, safe-area 대응
- [ ] PC(≥ 1024px): 좌측 사이드바(워크스페이스·캘린더 목록) + 넓은 월간 그리드 + 우측 상세 패널
- [ ] 로그인·가입·초대·공유 페이지도 같은 토큰으로 정리
- [ ] 신규 화면: 워크스페이스 전환·멤버 관리 / 크레딧(잔액, 원장 목록, 충전 → 모의 PG 결제 페이지 → 복귀 후 갱신) / 일정 편집의 리마인더 채널·시각 / 설정의 전화번호
- **완료 조건**: 375px(iPhone SE)·390px·1440px에서 가로 스크롤 없음. 데모 계정으로 로그인 → 충전(시나리오 `00`, `03`) → 원장 1행 증가 → 문자 리마인더 설정 → 가상 수신함에서 수신 확인

### PLANDIT-10 · Swagger·README·ADR [M]
- [ ] 새 API 전부 Swagger 예시·오류 스키마·태그
- [ ] README: 한 줄 소개("웹훅이 두 번 와도, 안 와도, 잔액은 한 번만 바뀝니다"), 아키텍처 다이어그램(mermaid), 실행 3줄, 시나리오 표, 설계 결정 링크, 테스트 실행법
- [ ] `docs/adr/0001-ledger-append-only.md`, `0002-reserve-before-external-call.md`, `0003-webhook-idempotency.md`, `0004-reminder-job-versioning.md`
- **완료 조건**: 처음 보는 사람이 README만 읽고 10분 안에 충전·리마인더 시나리오를 재현

### PLANDIT-11 · 무료 배포 [S]
- [ ] Oracle Cloud Always Free ARM VM 한 대에 `docker-compose.prod.yml`(web, api, worker, mocks, postgres, redis)
- [ ] DuckDNS 무료 서브도메인 + Caddy 자동 HTTPS. `/`(web), `/pg/*`·`/inbox/*`(mocks 화면). api·웹훅·mock 관리 API는 외부 비공개(내부 네트워크)
- [ ] 데모 계정 README 공개, 매일 04시 DB 리셋
- [ ] GitHub Actions: main push → SSH `git pull && docker compose up -d --build`
- **완료 조건**: 휴대폰 LTE에서 HTTPS로 로그인 → 충전 시나리오 재현. 재부팅 후 자동 복구

### PLANDIT-12 · 정합성 검증 도구 [S]
- [ ] `pnpm check:ledger`: 계정별 원장 합계 = 캐시, `balance_after` 연속성 검사. 불일치 시 종료 코드 1
- [ ] 워커에서 하루 1회 실행, 불일치 시 경고 로그

### 1주차 종료 기준
- PLANDIT-1~10 완료. e2e: 정상 충전 / 웹훅 중복 / 서명 오류 / 웹훅 유실 → 재조회 복구 / 동시 차감 50건 / 권한 403·404 / 리마인더 실패 환불 불변식
- 이 시점에 지원

---

## 2주차 — AI 일정 비서 (개요)

- PLANDIT-20 `LlmClient` + Claude 어댑터, 토큰→크레딧 환산표, 예상 선차감(DEBIT) → 실사용 정산(ADJUST), `ai_usages`
- PLANDIT-21 자연어 일정 등록 **Tool Calling**: 도구 `list_events`, `find_free_slots`, `create_event`, `update_event`. 쓰기 도구는 사용자 확인 후 실행. 대화·도구 호출 기록 저장
- PLANDIT-22 **RAG**: 일정 제목·설명·메모 청킹·임베딩(pgvector) → "지난달 A사 미팅에서 뭐 정했지?" 질의에 근거 일정 링크와 함께 답변. 권한 범위 밖 일정은 검색 대상에서 제외
- PLANDIT-23 같은 도구를 **MCP 서버**로 노출(사용자 토큰 기반)
- PLANDIT-24 AI 권한·한도: 워크스페이스별 월 AI 크레딧 상한, LLM 실패 시 환불
- PLANDIT-25 README에 AI 데모 GIF

## 3주차 — 규모·운영 (개요)

- PLANDIT-30 리마인더 대량 발송 k6: 중계사 초당 제한 하에 처리량 측정, 병목 개선(배치 INSERT, 워커 동시성) 전후 기록을 `docs/perf.md`에
- PLANDIT-31 결제 취소·환불(APPROVED만, 잔액 ≥ 지급 크레딧일 때)
- PLANDIT-32 월 정산 배치 + 워크스페이스별 사용량 통계 API
- PLANDIT-33 잔액 기준 자동충전(빌링키, 모의 PG billing API)
