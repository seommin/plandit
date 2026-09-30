# Plandit 확장 작업 계획

목표: [타임리 백엔드 포지션](https://timelyai.io/main/careers/backend-engineer)(TypeScript/NestJS, PostgreSQL/Prisma, Redis/Queue, 크레딧·결제·권한, LLM/RAG/Tool Calling) 지원용 포트폴리오.
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
- [x] `docker-compose.yml`: postgres를 `pgvector/pgvector:0.8.1-pg18`로, redis 7.4 추가(헬스체크). 개발은 로컬 실행이라 web·api 컨테이너·Dockerfile은 제거(배포용은 PLANDIT-11에서 새로 작성)
- [x] api: ESLint(flat) + Prettier 설정, Jest 단위(`src/**/*.spec.ts`)/e2e(`test/*.e2e-spec.ts`) 분리(@swc/jest), 루트 스크립트 `lint / test / test:e2e`
- [x] Swagger(`/docs`): **`z.toJSONSchema(target: openapi-3.0)`** 채택(추가 의존성 없음). `ApiZodBody(schema)` + `ZodPipe(schema)`
- [x] `ApiError` + `ErrorCode` + 전역 `ApiExceptionFilter`, 요청별 `traceId`(`X-Trace-Id` 수용/생성, 응답 헤더로 반환), 구조화 로그(nestjs-pino, 시크릿·쿠키 헤더 마스킹)
- [x] `@Public()` 데코레이터(InternalApiGuard 우회, 시크릿 비교는 timingSafeEqual), `/health`(DB·Redis 핑, 실패 시 503)
- [x] web의 오류 표시가 새 응답 형식(`message`)을 먼저 읽도록 수정
- [x] 정리: 중복 Prisma 클라이언트(`auth-prisma.ts`), `docs/DOCKER.md`, `docs/TECH_STACK.md` 제거
- **완료 조건**: `docker compose up -d` → `pnpm dev`로 web·api가 뜨고 `/health` 200, `/docs` 표시. 잘못된 입력 → 400에 필드별 details와 traceId ✅

### PLANDIT-2 · 워크스페이스·역할 [M]
- [x] `Workspace`, `WorkspaceMember`, `CreditAccount` 모델. 가입 시 개인 워크스페이스(OWNER) + 크레딧 계정 + 기본 캘린더를 한 트랜잭션에서 생성
- [x] OAuth 가입자(Auth.js가 web에서 생성)는 `ensurePersonalWorkspace()`로 지연 생성. `Workspace.personalOwnerId @unique`로 동시 호출에도 1개 보장
- [x] 마이그레이션: 기존 사용자마다 개인 워크스페이스·크레딧 계정 생성, 기존 캘린더를 OWNER의 개인 워크스페이스에 연결 후 `Calendar.workspaceId` NOT NULL
- [x] 워크스페이스 목록(cursor)·생성·상세·이름 변경, 멤버 목록(cursor)·추가(기존 사용자 이메일)·역할 변경·제거. ADMIN 이상만, 자기 역할 이하로만, 본인 멤버십 변경 불가, 개인 워크스페이스는 멤버 추가 불가
- [x] `roleCovers()`(`packages/shared/workspaces`), `@Roles()` + 전역 `RolesGuard`(경로 `/workspaces/:workspaceId/...`), `@CurrentMember()`
- [x] 캘린더 생성 시 `workspaceId` 지정(멤버만, 기본값: 개인 워크스페이스)
- [x] e2e는 별도 DB(`plandit_test`, Redis DB 1)에서 실행. globalSetup이 생성·마이그레이션
- 워크스페이스 **삭제는 보류**: 크레딧 원장(append-only)이 딸려 있어 물리 삭제와 충돌. 필요 시 보관(archive)으로 추가
- **완료 조건**: e2e — MEMBER가 역할 변경 시도 403, ADMIN이 OWNER 부여 시도 403, 비멤버가 워크스페이스 조회 404. 마이그레이션 후 기존 캘린더가 전부 워크스페이스에 연결됨 ✅ (개발 DB: 사용자 3명 → 개인 워크스페이스 3개, 캘린더 3개 연결)

### PLANDIT-3 · 크레딧 계정·원장 [M]
- [x] `LedgerService.append(input, tx?)` — 호출자 트랜잭션 합류 가능(웹훅 이벤트 + 원장 한 커밋용)
  - 트랜잭션 안에서 계정 행 `FOR UPDATE` → 멱등키 재확인 → `UPDATE … SET balance = balance + amount WHERE balance + amount >= 0 RETURNING` → 원장 INSERT(`balanceAfter` = 반환값). 잔액 계산은 SQL에서만
  - 잔액 부족 → `INSUFFICIENT_CREDITS`(409), 원장·캐시 변화 없음
  - 같은 `idempotencyKey` 재호출 → 기존 행 반환(`replayed: true`). 같은 키로 다른 금액·대상 → `IDEMPOTENCY_CONFLICT`
  - 타입별 부호 검증(CHARGE/REFUND > 0, DEBIT < 0, ADJUST ≠ 0)
- [x] `CreditLedger` UPDATE/DELETE 차단 트리거(SQL 마이그레이션). TRUNCATE는 테스트 DB 초기화용으로 허용
- [x] 잔액 조회(MEMBER), 원장 조회(ADMIN+, id cursor, type 필터, 기본 최신순)
- [x] 수동 조정: **플랫폼 운영자**(`PLATFORM_ADMIN_EMAILS`)만 — 워크스페이스 ADMIN이 스스로 크레딧을 만들 수 없게. memo·`Idempotency-Key` 헤더 필수. 감사 로그 `credit.adjusted`(재시도는 기록 안 함, PLANDIT-8)
- [x] `LedgerService.recalculate(accountId)`: 원장 합계로 캐시 재계산
- **완료 조건**: ✅
  - 단위: 타입별 부호 검증
  - e2e: 잔액 계산·캐시 동기화, 부족 시 거부(원장 변화 없음), 멱등 재호출, 키 충돌, 트리거 차단, 캐시 복구
  - e2e: 동시 DEBIT 50개(잔액 30) → 정확히 30개 성공, 원장 30행, `balanceAfter` 29→0 단조 감소, 캐시 = 원장 합계

### PLANDIT-4 · 모의 외부 서버 (`apps/mocks`) [M]
- 구현: Express 5 + `pg`, Node 24 네이티브 TypeScript 실행(빌드 단계 없음). 테이블은 기동 시 `mock` 스키마에 생성(제품 Prisma 스키마와 분리)
- PG (`/pg`)
  - [x] `POST /pg/v1/payments/reserve`(merchantTradeId, amount, returnUrl, webhookUrl?) → `txId`, `paymentPageUrl`. 같은 merchantTradeId 재호출은 기존 거래 반환, 금액이 다르면 409
  - [x] 결제 페이지(모바일 폭 HTML) "승인"/"취소". 승인 시 returnUrl로 303 리다이렉트 + **비동기 웹훅**
  - [x] `POST …/{txId}/confirm`(한 번만 승인), `POST …/{txId}/cancel`(APPROVED만), `GET …/{txId}`, `GET …?merchantTradeId=`(reserve 응답 유실 대비)
  - [x] 웹훅 body `{ eventId, txId, merchantTradeId, type, amount, method, failureCode, occurredAt }`, 헤더 `X-Mock-Signature: HMAC-SHA256(secret, rawBody)`
  - [x] 시나리오(금액 끝 두 자리): `00` 정상 / `01` 승인 실패 / `02` confirm 응답 지연(승인은 즉시 기록) / `03` 웹훅 2회(같은 eventId) / `04` 웹훅 지연 / `05` 웹훅 안 보냄. 지연 시간은 환경변수
  - [x] 거래 목록 페이지 `GET /pg/admin`
- 중계사 (`/relay`)
  - [x] `POST /relay/v1/messages`(to, body, kind, clientRef?, callbackUrl?) → `202 msgId`, `RELAY_DELAY_MS` 뒤 결과 웹훅(DELIVERED/FAILED), `GET …/{msgId}` 재조회
  - [x] 시나리오: 수신번호 끝자리 `9` → `INVALID_NUMBER`. 환경변수 `RELAY_FAIL_RATE`(`CARRIER_ERROR`), `RELAY_DELAY_MS`, `RELAY_RPS`(초과 시 429 + Retry-After)
  - [x] **가상 수신함** `GET /inbox?phone=`: 번호별로 도착한 문자 목록
- [x] `mock.pg_transactions`, `mock.pg_events`, `mock.relay_messages` 테이블, `POST /…/admin/webhooks/{eventId}/resend`
- [x] 테스트 11개(Node 내장 테스트 러너): 서명 검증, 시나리오 00~05, 결제 페이지 리다이렉트, 환불, 재전송, 중계사 결과·수신함·429. 루트 `pnpm test:e2e`에 포함
- 알려진 한계: 웹훅·결과 타이머가 프로세스 메모리에 있어 재시작 시 대기 중인 웹훅은 사라짐 → 재조회 API와 재전송 API로 복구(이것 자체가 PLANDIT-6·7 재조회 스케줄러의 존재 이유)
- **완료 조건**: curl만으로 reserve→confirm→웹훅, 문자 접수→결과 웹훅을 재현하는 절차가 `apps/mocks/README.md`에 있다 ✅ (절차대로 실행해 확인)

### PLANDIT-5 · 충전 흐름 [M]
- [x] `PaymentGateway` 인터페이스(reserve, parseWebhook) + `MockPgAdapter`(`PAYMENT_PROVIDER=mock`). 서비스는 인터페이스만 안다
- [x] `POST /workspaces/:id/payments/charge` { amount: 1,000~1,000,000원 }(ADMIN 이상) → **`Payment` RESERVE 저장(tradeId `P{yyMMdd}-{seq}`, DB 시퀀스로 발급)** → PG reserve → `paymentPageUrl`
  - PG가 명확히 거절(4xx) → FAILED, 타임아웃·5xx·연결 실패 → **UNKNOWN**(PG에 기록됐을 수도 있으므로 재조회 대상) + 502 `PAYMENT_GATEWAY_ERROR`
  - 크레딧 환산: 1크레딧 = 10원(`packages/shared/credits`)
- [x] returnUrl(`/credits/charge-result`)은 화면용. **원장 반영은 웹훅에서만**
- [x] `POST /webhooks/payments/mock`(@Public, raw body 서명 검증): `PaymentEvent` INSERT(`eventId` unique, 중복이면 `DUPLICATE_EVENT`로 200 종료) → Payment 행 `FOR UPDATE` → 금액 대조 → 상태 전이(RESERVE/UNKNOWN → APPROVED·FAILED) → `LedgerService.append(CHARGE, "PAYMENT:{id}:CHARGE", tx)` → APPROVED + ledgerId. **한 트랜잭션**, 예외 시 전부 롤백되어 PG 재전송을 깨끗하게 받음
  - 처리 결과를 이벤트 행에 기록: APPLIED / ALREADY_APPLIED / UNKNOWN_PAYMENT / AMOUNT_MISMATCH / CONFLICT_STATE(닫힌 결제에 승인 도착 → 운영자 확인) / UNHANDLED(CANCELED, PLANDIT-31)
- [x] 승인 처리 `PaymentService.applyApproval(tx, …)`는 웹훅과 PLANDIT-6 재조회가 같은 멱등키로 공유
- [x] 결제 목록(cursor)·단건 조회(ADMIN 이상)
- 감사 로그 `payment.approved`, `payment.failed`(PLANDIT-8에서 연결, 실패 처리도 `applyFailure()`로 통합)
- **완료 조건**: ✅ e2e(실제 모의 PG 프로세스를 띄워서 실행) — 정상(원장 1행, APPROVED) / 시나리오 `03` 중복(이벤트 1행, 원장 1행) / 잘못된 서명 401·변화 없음 / 다른 eventId로 APPROVED 재수신 → 이벤트 저장, 원장 1행 유지 / 금액 불일치 미반영 / `01` 실패 / PG 다운 → 502 + UNKNOWN / 권한·입력 검증. 개발 서버에서도 10,000원 충전 → 결제 페이지 승인 → 1,000크레딧 확인

### PLANDIT-6 · 미확정 결제 재조회 (worker) [M]
- [x] `apps/api/src/worker.ts` 진입점(Nest 애플리케이션 컨텍스트, HTTP 없음) + `WorkerModule`. api와 같은 서비스를 모듈 단위로 공유(`CreditModule`, `PaymentModule`로 분리)
- [x] BullMQ Job Scheduler(`RECONCILE_EVERY_MS`, 기본 1분). 여러 워커가 떠도 주기당 작업은 1개, concurrency 1
- [x] 대상: RESERVE·UNKNOWN 중 `RECONCILE_MIN_AGE_MS`(기본 5분) 지난 건, 한 번에 100건. PG 재조회(`PaymentGateway.lookup`, tradeId 기준 → reserve 응답이 유실돼도 조회 가능)는 트랜잭션 밖에서, 반영은 결제 행 `FOR UPDATE` 후
  - PG 승인 → 웹훅과 **같은 `applyApproval()`·같은 멱등키**로 APPROVED + CHARGE
  - PG 실패·취소 → FAILED/CANCELED
  - PG가 모르는 거래(우리 reserve가 도달 못 함) → FAILED `PG_NOT_FOUND`(아무도 결제할 수 없으므로 안전)
  - PG에서 아직 미결제 → 대기, `PAYMENT_EXPIRE_AFTER_MS`(24시간) 지나면 FAILED `EXPIRED`
  - 그사이 웹훅이 먼저 처리했으면 손대지 않음(`settled`), 금액 불일치는 반영하지 않고 오류 로그
- 감사 로그 `payment.expired`, 처리 경로(`source: webhook|reconcile`) 기록(PLANDIT-8)
- **완료 조건**: ✅ e2e — 시나리오 `05` 충전 → 재조회 → APPROVED, 원장 1행 → 늦은 웹훅(원 이벤트 재전송) → `ALREADY_APPLIED`, 원장 1행 유지 / PG 미도달 UNKNOWN → FAILED / 미결제 대기 → 25시간 후 만료 / 웹훅이 먼저 처리한 건 무시 / 최소 경과 시간 / **실제 BullMQ 워커가 스케줄로 스스로 실행**해 승인. `pnpm dev`에 워커 포함

### PLANDIT-7 · 리마인더 발송 큐 [M]
- [x] `EventReminder`(eventId, minutesBefore, channel PUSH/SMS/ALIMTALK, audience CREATOR/ATTENDEES) + `User.phone`(`PATCH /me`)
- [x] `PUT /events/:id/reminders`(목록 교체, 바뀌지 않은 항목은 id·예약 작업 유지), `GET` 조회. 일정 수정 시 `syncEvent()`로 재예약
- [x] BullMQ **지연 작업** `fire`, jobId = `fire_{reminderId}_{fireAt epoch}`(BullMQ 커스텀 id에 `:` 금지라 `_`). 시각이 바뀌면 새 jobId, 옛 작업은 실행 시 현재 발송 시각과 비교해 `stale`로 무시. 이미 지난 시각은 예약하지 않음
- [x] 발송 시각: 시간 일정은 시작 − N분, **종일 일정은 캘린더 타임존 09:00 − N분**(서머타임 반영)
- [x] `fire` → 수신자별 `ReminderDelivery` **QUEUED 선기록**(unique(reminderId, userId, fireAt), 재시도해도 1건) → 건별 `send` 작업으로 분리(건마다 재시도·백오프)
  - PUSH: 기존 `PushProviderClient`, 크레딧 0
  - SMS/ALIMTALK: `LedgerService.append(DEBIT, "REMINDER_DELIVERY:{id}:DEBIT")` → `MessageProvider.send(clientRef = deliveryId)` → SENT. 번호 없음·잔액 부족이면 SKIPPED(원장 없음) + 푸시 대체 발송(`fallback`)
  - **중계사 멱등**: 모의 중계사가 같은 `clientRef`를 같은 메시지로 처리 → 응답 유실 후 재시도해도 문자 1통
- [x] 중계사 결과 웹훅(@Public, HMAC): `RelayEvent` 멱등 → 발송 건 `FOR UPDATE` → DELIVERED/FAILED → 실패 건 **자동 환불**(REFUND, `"REMINDER_DELIVERY:{id}:REFUND"`), 한 트랜잭션
- [x] 429/5xx 지수 백오프(`RELAY_SEND_ATTEMPTS`, `RELAY_BACKOFF_MS`), 마지막 시도까지 실패하면 FAILED + 환불. 워커 동시성 `REMINDER_SEND_CONCURRENCY`
- [x] 미확정(SENT 후 `RELAY_RESULT_TIMEOUT_MS` 결과 없음) 재조회 반복 작업: 중계사 조회 → 결과 반영, 중계사에 기록 없으면 FAILED(`RELAY_LOST`) + 환불
- [x] 워크스페이스 발송 내역 API(ADMIN+, 상태 필터, cursor)
- **완료 조건**: ✅
  - 단위: 발송 시각 계산(시간 일정, 종일 일정 UTC·KST 자정 저장 모두, 서머타임)
  - e2e(API + 실제 BullMQ 워커 + 모의 중계사 프로세스): 일정 시간 변경 → 옛 시각 발송 0건·새 시각 작업 존재 / 결과 웹훅 재전송 → 환불 1행 / **수신자 100명 중 30명 실패(초당 25건 제한으로 429 백오프 발생)** → `차감 = 성공 차감 + 실패 환불`, 환불 30행·이중 환불 0건 / 배달 완료 건에 늦은 실패 → 환불 없음 / 위조 서명 401 / 잔액 부족 SKIPPED / 푸시 무료 / 결과 웹훅 유실 → 재조회로 확정
  - 개발 서버에서 문자 리마인더 → 가상 수신함 도착 확인

### PLANDIT-8 · 감사 로그 [M]
- [x] `AuditLog`(append-only 트리거) + 전역 `AuditService.record(entry, tx)`: **변경과 같은 트랜잭션**에 기록 → 변경이 커밋될 때만 감사 행이 남음
- [x] 기록 대상: `workspace.created / renamed / member_added / member_role_changed / member_removed`, `credit.adjusted`, `payment.approved / failed / expired`(payload에 `source`: charge·webhook·reconcile). 시스템 작업은 actor null
- [x] 요청 컨텍스트(AsyncLocalStorage, `traceMiddleware`): traceId·IP·user agent를 서비스 깊이까지 전달. web 프록시가 사용자 IP(`x-forwarded-for`)·기기(`x-client-user-agent`)를 전달
- [x] 조회 API `GET /workspaces/:id/audit-logs`(ADMIN 이상, 최신순, id cursor, action 정확 일치 또는 `payment.`처럼 접두어)
- **완료 조건**: ✅ PLANDIT-2(워크스페이스)·3(수동 조정)·5(결제)·6(재조회) e2e에서 감사 행 수를 함께 검증 — 성공한 변경당 정확히 1행, 거부된 시도·중복 웹훅·재시도는 0행. traceId·IP·기기 기록, 목록 권한·필터·페이지네이션, DB 수정·삭제 차단

### PLANDIT-9 · 모바일 우선 UI 전면 개편 [M]
모바일이 주 화면, PC는 같은 컴포넌트를 넓게 펼친 보조 화면.
- [x] 디자인 토큰(색·그림자, 라이트/다크)을 `globals.css`의 CSS 변수 + Tailwind `@theme inline`으로 정리(`bg-surface`, `text-fg-2`, `bg-primary` …). 하드코딩 색과 다크 모드 덮어쓰기 해킹 제거. Pretendard 유지
- [x] `calendar-app.tsx`(2,820줄 단일 파일) 삭제 → `components/`(ui, month-grid, event-sheet, calendar-sheet, app-shell …) + 화면별 라우트(`app/(app)/…`)
- [x] 모바일: 하단 탭 바(캘린더 / 일정 / + / 크레딧 / 설정), 월간 달력(여러 날 일정은 이어진 막대, 레인 배치) + 선택일 일정 리스트, 모든 폼은 바텀시트, 44px 터치 영역, `viewport-fit=cover` + safe-area
- [x] PC(≥ 1024px): 좌측 사이드바 + 넓은 월간 그리드(드래그로 일정 이동) + 우측 선택일·캘린더 패널. 시트는 가운데 다이얼로그
- [x] 로그인·가입·비밀번호 찾기/재설정·초대·공유 페이지를 같은 토큰으로 정리. 설정된 소셜 로그인만 표시, 데모 계정 버튼(선택)
- [x] 신규 화면: 일정 탭(다가오는/중요/지난, 검색) / 크레딧(워크스페이스 전환, 잔액, 충전 → 모의 PG → 결제 결과 대기 화면, 사용·결제·발송 내역) / 일정의 알림(푸시·문자·알림톡, 크레딧 안내) / 설정(전화번호, 테마, 워크스페이스·캘린더 관리, 푸시) / 워크스페이스(멤버·역할, API 키 발급·폐기, 활동 기록)
- [x] web API 라우트 14개(세션 확인 후 그대로 전달하던 파일)를 인증 캐치올 프록시 `app/api/[...path]` 하나로 교체
- [x] 버그 수정: 서버가 **2026년 6월 일정만** 불러오던 하드코딩 → 보이는 달 범위를 불러오고 이동 시 다시 조회
- [x] `pnpm seed:demo`: 데모 계정 2개·팀 워크스페이스·크레딧·이번 주 일정(멱등, PLANDIT-11 데모 리셋에 재사용)
- [x] 날짜 로직 테스트(`apps/web/src/lib/dates.test.ts`, Node 테스트 러너), `next build` 통과
- **완료 조건**: ✅ 375·390·1440px 전 화면 가로 스크롤 없음(iframe으로 측정). 데모 계정 로그인 → 충전 00 → 결제 결과 "1,000 크레딧" → 원장 +1행 → 일정에 문자 알림 설정 → 가상 수신함 도착 확인
- 2차 재구성(피드백: "등록/수정/삭제 모두 편하게", 모던·미니멀):
  - [x] 토큰 교체: 무채색 + 검정 주 버튼, 그림자 대신 헤어라인, 강조색은 오늘·현재 시각에만. 요소 기본값을 `@layer base`로 옮겨 버튼의 글자색·굵기 유틸리티가 먹지 않던 버그 수정
  - [x] 모바일: 주간 스트립(좌우 스와이프 = 주 이동, 아래로 당기면 월간) + 하루 타임라인(현재 시각 선, 겹치는 일정 나란히 배치)
  - [x] PC: 일/주/월 전환(기본 주), 넓은 화면은 미니 달력 + 캘린더 필터 패널. 단축키 c·t·d·w·m·←/→
  - [x] 등록: 빈 시간을 탭하면 그 시각으로 바로 새 일정. 수정: 일정을 탭하면 바로 편집 시트(보기 전용 캘린더는 읽기 전용)
  - [x] 편집 시트 하나로 통합(`event-editor.tsx`): 큰 제목, 날짜·시간 칩을 누르면 그 자리에서 달력/15분 목록, 길이 프리셋(30분~2시간), 캘린더 칩, 알림·장소·메모
  - [x] 이동·길이 조절: 끌어서 이동(주간은 다른 요일로도), 아래 끝을 끌어 길이 조절, 터치는 길게 눌러 시작. 저장은 낙관적 + "되돌리기" 토스트
  - [x] 삭제: 확인창 없이 즉시 삭제 + "되돌리기"(알림·중요 표시까지 다시 만듦)
  - [x] 일정 탭·일정 행을 같은 톤으로 정리, 옛 `event-sheet.tsx` 삭제
- 3차 흑백 톤(피드백: "무채색이 더 모던", 참고 무신사·KREAM·29CM):
  - [x] 강조색 제거: 오늘·현재 시각도 검정. 주말 빨강·파랑 제거. 중요 ★도 검정. 빨강·초록은 삭제·오류·결제 결과처럼 뜻이 있을 때만
  - [x] 선택 상태는 검정 채우기 대신 1px 검정 테두리. 모서리 반경 축소(6·8·12·16px), 동그란 알약 버튼 제거
  - [x] 로고는 필기체 유지(검토 결과)
  - [x] 한글 글꼴 수정: `@fontsource/pretendard`는 라틴 글자만 있어 한글이 맑은 고딕으로 나오던 문제 → Pretendard 가변 글꼴(dynamic subset)
  - [x] 캘린더 기본색을 파랑에서 그래파이트(`#3F3F46`)로(마이그레이션 `calendar_default_graphite`), 색상표를 차분한 톤 8가지로. 이미 만든 캘린더의 색은 사용자 데이터라 바꾸지 않음
- 4차(피드백):
  - [x] 토·일·공휴일 색 표기(일요일·공휴일 빨강, 토요일 파랑). 공휴일은 관보 기준 데이터 패키지 `@hyunbinseo/holidays-kr`(대체·임시공휴일 포함, 2018–2027) — 음력·대체공휴일을 손으로 적지 않기 위해. 공휴일 이름은 월간 칸과 타임라인 종일 줄에 표시. 새 해가 발표되면 패키지 버전만 올림
  - [x] 타임라인 빈 곳에 마우스를 올리면 그 30분 칸에 배경·시각 표시(클릭하면 여기에 만들어진다는 뜻)
  - [x] 빈 시간을 끌어서 범위를 잡으면 그 시작·끝으로 새 일정(같은 날 안에서). 터치는 길게 누른 뒤 끌기
- 5차(피드백):
  - [x] 끌기(만들기·옮기기·길이 조절)는 정각·30분 단위로만
  - [x] 팀 일정 색을 검정과 구분되는 파랑(`#4A6FC4`)으로
  - [x] 사이드바 아래 카드: 의미 없던 워크스페이스 이름 대신 이름·이메일, 누르면 설정
  - [x] 개발 서버가 옛 CSS를 내주던 원인 확인(아래 troubleshooting 11) — 머지 방식 변경
- 6차(피드백: "워크스페이스는 왜 있나"):
  - [x] 워크스페이스별 보기: 전체 / 개인 / 팀마다 고르면 그 워크스페이스의 캘린더·일정만 보이고, 새 일정도 그 안의 캘린더로. 브라우저마다 기억. 캘린더 목록은 워크스페이스별로 묶음(워크스페이스 멤버가 아닌데 초대받은 캘린더는 "공유받은 캘린더")
  - [x] 색상표를 그래파이트와 한눈에 구분되는 밝기로. 선택 칩 테두리를 안쪽에 그려 가로 스크롤 가장자리에서 잘리지 않게
  - [x] 사이드바 로고 가운데 정렬
  - [x] 워크스페이스 고르기는 글자 탭(선택만 검정 밑줄). 4개 이상이면 "이름 ▾" 한 줄 + 기기 기본 목록
  - [x] 새 일정은 캘린더를 여러 개 골라 한 번에 추가(캘린더마다 따로 한 건씩, 이후 따로 수정). 중간에 실패하면 이미 만든 캘린더는 목록에서 빼서 다시 저장해도 중복되지 않음
  - [x] 새 일정 끌기를 좌우로도: 주간 보기에서 여러 요일에 걸쳐 끌면 그 시작~끝으로 한 건(기존 일정 좌우 이동은 이미 됨)
- 7차(전체 재검토 — 모던·미니멀 기준):
  - [x] 브라우저 기본 선택 목록 7곳을 직접 만든 펼침 목록(`Picker`)으로 교체: 알림 시점·방법, 멤버·캘린더 권한, 초대 권한, 캘린더의 워크스페이스, API 키 만료, 워크스페이스가 많을 때. 목록은 화면 맨 위층에 띄워 카드·시트에 잘리지 않고, 아래가 좁으면 위로 펼침. 기본 `Select` 부품 삭제
  - [x] 탭 규칙: 보기 방식(일/주/월, 테마)은 회색 바탕 전환 버튼, 내용 구분(일정 탭, 크레딧 내역, 워크스페이스)은 밑줄 글자 탭(`Tabs`)
  - [x] 선택 표시는 모두 1px 검정 테두리(충전 금액 포함). 상태 표시는 완료=검정 글씨, 대기=회색, 실패만 빨강. 성공 알림도 회색 바탕
  - [x] "하루 종일" 스위치가 꺼져 있어도 동그라미가 오른쪽에 있던 버그, "테스트 결제 안내"의 기본 삼각형 표시
  - [x] 테마 적용 코드를 `next/script`(첫 화면 전)로
- 8차(버그: 시간대 — 배포 서버가 UTC이고 사용자가 한국 시간일 때):
  - [x] 캘린더 첫 화면에서 서버가 그린 화면과 브라우저가 그린 화면이 달라 React 경고가 나고 화면을 다시 그리던 문제. "오늘"·보이는 달·일정 위치가 보는 사람의 시간대에 따라 달라서였음 → 서버와 첫 화면은 같은 뼈대만 그리고 캘린더는 브라우저에서 그림(`useHydrated`). 한국·UTC·미국 서부 시간대로 모든 화면 확인
  - [x] 서버가 **서버 시간대의** 이번 달 일정을 넘겨서, 한국 시간 매달 1일 0~9시에는 이번 달 일정이 빠진 채 보이던 문제 → 앞뒤로 하루 여유를 두고 가져온 기간(`range`)을 함께 넘김. 브라우저의 기간을 다 덮지 못하면 다시 가져옴(`rangeCovers`, 단위 테스트). 배포용 빌드에서 평소 추가 요청 0번, 10월 1일 새벽 5시(한국)에는 10월 1번 확인
- 디자인 검토 대기: 4차 결과 확인 후 피드백 반영

### PLANDIT-10 · Swagger·README·ADR [M]
- [x] 새 API 전부 Swagger 예시·오류 스키마·태그
  - 공용 오류 형식 `ApiError`(`{ code, message, details?, traceId }`)를 문서에 등록하고, `@ApiErrors(코드…)`로 상태 코드별 예시. web 서버 전용 경로의 401은 한곳에서 자동으로
  - 분류는 한국어 16개(순서·설명 포함). 요약·설명·요청 예시·응답 예시(데모 데이터에서 받은 실제 응답)
  - 경로별 인증 표시: 웹훅은 서명(`x-mock-signature`, 보안 요구 없음), `/v1`은 API 키, 나머지는 web 서버 헤더. **문서에서 빠져 있던 웹훅 2개**를 본문 형식·결과값과 함께 추가
  - e2e로 지킴: 모든 경로에 요약과 정해진 분류, 웹훅·`/v1` 인증 표시(`foundation.e2e-spec.ts`)
- [x] README: 한 줄 소개, 구조 그림·충전 흐름 순서도(mermaid), 실행 3줄, 10분 시나리오, 시나리오 표(e2e 파일 연결), 설계 결정 링크, 테스트 실행법
- [x] README: 공고 용어 대응표, AI 개발 도구로 일한 방식 한 단락
- [x] `docs/adr/0001-ledger-append-only.md`, `0002-reserve-before-external-call.md`, `0003-webhook-idempotency.md`, `0004-reminder-job-versioning.md`
- [x] 버그 수정(문서 작업 중 발견): 공개 링크 조회 API가 링크 주인이 가린 설명·장소와 내부 id·캘린더 정보까지 그대로 돌려줌(가리기는 공개 페이지 화면에서만) → 공개 페이지에 필요한 값만, 가린 항목은 서버에서 `null`. e2e `shares.e2e-spec.ts`
- [x] 버그 수정: 새로 받은 폴더에서 Prisma 클라이언트가 생성되지 않아 `seed:demo` 실패 → 루트 `postinstall`에서 생성(troubleshooting 12)
- 후속(확인 필요): 캘린더 API는 역할이 모자란 행위(VIEWER의 수정 등)에 403 대신 404를 준다 — "권한 부족 행위는 403" 규칙과 다름. `GET /calendar/state`는 `from`·`to`가 없으면 2026년 6월로 고정된 기본값을 쓴다(화면은 항상 넘기므로 영향 없음)
- **완료 조건**: 처음 보는 사람이 README만 읽고 10분 안에 충전·리마인더 시나리오를 재현 ✅ 새로 받은 폴더에서 README 절차 그대로 실행 — 설치·마이그레이션·데모 데이터(위 postinstall 수정 후) → 10,003원 충전: 웹훅 2회 발송·이벤트 1행·원장 1행, 잔액 +1,000 → 팀 일정 문자 리마인더: 가상 수신함 도착

### PLANDIT-11 · 무료 배포 [S]
- [x] 이미지 하나(`Dockerfile`, `node:24-bookworm` — Prisma 마이그레이션 엔진이 쓰는 OpenSSL이 있어 apt 단계 없음)를 모든 프로세스가 명령만 바꿔 씀. 컴파일된 api는 `register-dist.cjs`로 `@plandit/*`를 dist 사본에 연결
- [x] `docker-compose.prod.yml`: migrate(마이그레이션 후 종료) → api·worker·mocks·web, postgres(pgvector)·redis(AOF). 전부 `restart: unless-stopped`, 밖으로 열린 포트는 Caddy(80·443)뿐
- [x] Caddy 자동 HTTPS(`deploy/Caddyfile`). 공개 경로는 `/`(web), `/pg/pay/*`(결제 화면), `/inbox`(가상 수신함)만. api·웹훅·모의 서버 관리 API(`/pg/v1`, `/pg/admin`)는 내부 네트워크에서만
- [x] 스크립트: `deploy/init-env.sh`(무작위 비밀값으로 `.env.production`, 덮어쓰기 거부), `deploy.sh`, `seed-demo.sh`, `reset-demo.sh`(매일 04시 KST cron 예시), `github-secrets.sh`(배포 명령만 실행 가능한 SSH 키 + GitHub 비밀값 출력)
- [x] GitHub Actions(`.github/workflows/ci.yml`): 모든 push에 lint·typecheck·test·e2e(Postgres·Redis 서비스 컨테이너). main push는 검사 통과 후 SSH로 `deploy/deploy.sh` — `DEPLOY_*` 비밀값이 있을 때만
- [x] 한국어 설치 안내 `docs/deploy.md`(Oracle 가입 → ARM 서버 → 방화벽 2곳 → DuckDNS → 도커 → 띄우기 → 휴대폰 확인 → 자동 배포·초기화). 공개 데모는 `LLM_PROVIDER=mock` 유지(모의 결제로 크레딧이 공짜라 진짜 키를 넣으면 남이 쓸 수 있음)
- [x] 로컬 도커로 운영 구성 확인(`DOMAIN=localhost`): 빌드·기동, HTTPS 로그인 → 10,000원 충전 → "1,000 크레딧" → AI 여행 일정 생성·적용, 비공개 경로 404·401, http → https, 도커 재시작 후 자동 복구·데이터 유지, `reset-demo.sh`
- [ ] **사용자 작업**: Oracle 서버 생성·DuckDNS 등록 후 `docs/deploy.md` 순서대로 띄우기, README에 공개 주소 적기, (선택) GitHub 비밀값·cron 등록
- **완료 조건**: 휴대폰 LTE에서 HTTPS로 로그인 → 충전 시나리오 재현. 재부팅 후 자동 복구 — 로컬 도커로는 확인, 실제 ARM 서버에서는 아직

### PLANDIT-12 · 정합성 검증 도구 [S]
- [ ] `pnpm check:ledger`: 계정별 원장 합계 = 캐시, `balance_after` 연속성 검사. 불일치 시 종료 코드 1
- [ ] 워커에서 하루 1회 실행, 불일치 시 경고 로그

### PLANDIT-13 · API 키 인증 + 요청 수 제한 [M]
채용공고의 "인증/권한"을 API 쪽에서 직접 보여주는 이슈. 2주차 MCP 서버와 외부 연동의 전제.
- [x] `ApiKey`: workspaceId, userId(발급자), name, prefix(`pk_` + 8자, 표시용), keyHash(SHA-256 — 192비트 난수 토큰이라 bcrypt 같은 느린 해시 불필요, **원문은 발급 응답에서 한 번만**), scopes(`events:read`, `events:write`, `credits:read`), expiresAt, lastUsedAt(분당 1회만 갱신), revokedAt
- [x] 발급·목록·폐기 API(`/workspaces/:id/api-keys`): 본인 키는 본인이, 워크스페이스의 모든 키는 ADMIN 이상이 조회·폐기(남의 키는 404)
- [x] "발급자 권한을 넘을 수 없음" = **요청마다 발급자의 현재 멤버십을 확인**. 발급자가 워크스페이스를 떠나면 키도 즉시 무효, 일정은 발급자의 캘린더 권한·공개 범위 그대로
- [x] 공개 API `/v1/events`(조회 cursor·기간, 생성), `/v1/credits`: `@Public()` + `ApiKeyGuard`(Bearer → 해시 조회 → 만료·폐기·멤버십 → 요청 수 → 스코프). Swagger에 bearer 인증 표시
- [x] 요청 수 제한: 키별 Redis 고정 윈도(`MULTI INCR + EXPIRE`, `API_KEY_RATE_LIMIT_PER_MIN`), 초과 시 429 + `Retry-After`, 헤더 `X-RateLimit-Limit/Remaining`
- [x] 감사 로그 `api_key.created`, `api_key.revoked`
- **완료 조건**: ✅ e2e — 없음·형식 오류·모르는 키·폐기·만료 키 모두 401(같은 본문), 발급자 탈퇴 시 401, 스코프 없는 요청 403, 다른 워크스페이스 캘린더 404, 한도 초과 429 + Retry-After, DB·목록 응답에 키 원문 없음, 감사 행 수 일치

### PLANDIT-14 · 모니터링 + 장애 대응 런북 [M]
채용공고의 "로깅, 모니터링, 장애 대응"에 대응.
- [x] `/metrics`(Prometheus, `prom-client`): 라우트 **패턴**별 요청 수·지연(원시 URL·id는 라벨에 넣지 않음), BullMQ 큐 상태별 작업 수, 웹훅 결과(`invalid_signature` 포함), 원장 append 결과(applied/replayed/insufficient), 미확정 결제 수·가장 오래된 나이, 발송 대기 수. `METRICS_TOKEN`(bearer), 프록시에서도 차단
- [x] 워커는 HTTP 앱이 없어 `WORKER_METRICS_PORT`에 별도 `/metrics`(작업 성공·실패, 발송 결과, 원장 append)
- [x] traceId 전파: 리마인더 예약 요청의 traceId를 `fire` → `send` 작업 payload로 전달, 워커는 작업을 그 traceId의 요청 컨텍스트 안에서 실행. pino `mixin`으로 **api·워커의 모든 로그 줄**에 traceId, 워커가 남기는 감사 로그에도 같은 traceId
- [x] 운영자 복구 API(`OperatorGuard`): `POST /admin/jobs/payment-reconcile?minAgeMs=0`, `POST /admin/jobs/reminder-reconcile`, `POST /admin/credit-accounts/:id/recalculate` — 스케줄 작업과 같은 코드를 즉시 실행
- [x] 429 재시도 백오프에 지터(0.5) 추가 — 재시도가 한 시각에 몰리던 문제(트러블슈팅 1번)
- [x] `docs/runbook.md`: 지표 요약·알림 기준, 증상별(A 미확정 결제, B 서명 실패, C 충돌·금액 불일치, D 리마인더 적체, E 원장·캐시 불일치, F 잔액 부족) 확인·복구·정상화 확인
- [x] `docs/troubleshooting.md`: 실제로 겪은 8건
- **완료 조건**: ✅ e2e — 시나리오 `05` 재현 → `plandit_payments_unsettled{status="RESERVE"} 1` → 운영자가 런북 명령 실행(`X-Trace-Id: runbook-incident-42`) → 지표 0, CHARGE 1회, 감사 로그에 같은 traceId. 캐시 불일치 복구, 지표 토큰, 라우트 패턴 라벨, 리마인더 작업의 traceId 전파

### 진행 순서
번호는 한 번 정하면 바꾸지 않는다. 1주차 진행 순서: 5 → 6 → 7 → 8 → 13 → 14 → 9 → 10 → 11 → 12

### 1주차 종료 기준
- PLANDIT-1~10, 13, 14 완료. e2e: 정상 충전 / 웹훅 중복 / 서명 오류 / 웹훅 유실 → 재조회 복구 / 동시 차감 50건 / 권한 403·404 / 리마인더 실패 환불 불변식 / API 키 401·403·429
- 이 시점에 지원

---

## 2주차 — AI 일정 비서 (개요)

- PLANDIT-20 `LlmClient` + Claude 어댑터, 토큰→크레딧 환산표, 예상 선차감(DEBIT) → 실사용 정산(ADJUST), 실패 환불, `ai_usages`. 아래 상세
- PLANDIT-21 **AI 에이전트(Tool Calling 루프)**: "다음 주에 팀 전원이 되는 시간에 회의 잡아줘" → 모델이 도구를 여러 단계 호출(`list_events` → `find_free_slots` → `create_event`). 최대 단계 수·크레딧 한도·타임아웃, 쓰기 도구는 **사용자 승인 후 실행**(승인 대기 상태 저장), 단계별 도구 호출·결과 기록
- PLANDIT-22 **RAG**: 임베딩은 Anthropic API에 없으므로 별도 제공자(예: Voyage AI)를 `EmbeddingClient` 인터페이스 뒤에 둔다(PLANDIT-20에서 옮김). 일정(제목·설명·장소) + **회의록 파일(PDF·TXT) 업로드** → 텍스트 추출·청킹·임베딩(pgvector)은 큐 작업으로 비동기 처리(진행 상태 표시, 크기·형식 검증) → "지난달 A사 미팅에서 뭐 정했지?"에 근거 인용과 함께 답변. 권한 범위 밖 문서·일정은 검색 대상에서 제외
- PLANDIT-23 같은 도구를 **MCP 서버**로 노출(사용자 토큰 기반)
- PLANDIT-24 AI 권한·한도: 워크스페이스별 월 AI 크레딧 상한(LLM 실패 환불은 PLANDIT-20에서)
- PLANDIT-25 README에 AI 데모 GIF
- PLANDIT-26 **AI 여행 일정 만들기**(양식 → 초안 → 확인 → 한 번에 저장, 함께 갈 멤버는 참석자로, 캘린더 멤버가 아니면 자동 추가). 아래 상세

### PLANDIT-20 · LLM 연결 + AI 크레딧 과금
AI 기능이 함께 쓰는 바닥. 기능(PLANDIT-21·26)은 `AiUsageService`만 부르고, 모델 호출·과금·환불은 여기서 끝낸다.
- [x] `LlmClient` 인터페이스(`apps/api/src/ai/llm-client.ts`): `complete({ system, messages, maxOutputTokens, effort?, jsonSchema? })` → `{ model, text, stopReason(end / max_tokens / refusal / other), attempts[] }`. `attempts`는 시도별 토큰(모델·입력·출력·캐시 읽기·캐시 쓰기)으로 과금의 근거. 오류는 `LlmError(code)`: `LLM_TIMEOUT / LLM_RATE_LIMITED / LLM_OVERLOADED / LLM_UNAVAILABLE / LLM_BAD_REQUEST / LLM_AUTH / LLM_ERROR`. `servingModels`: 요청을 처리할 수 있는 모든 모델(설정 모델 + 서버 측 대체 모델)
- [x] 구현체는 `LLM_PROVIDER`로 고른다(`mock` 기본 — API 키 없이 로컬·테스트가 돈다 / `anthropic`)
  - Claude 어댑터: 공식 SDK(`@anthropic-ai/sdk`), 모델 `LLM_MODEL`(기본 `claude-opus-5-5`). 구조화 출력은 `output_config.format`(json_schema) — 이 모델은 강제 `tool_choice`가 400이라 도구 강제 호출로 JSON을 받지 않는다. 사고(thinking)는 끌 수 없어 `output_config.effort`로 조절(모델 기본값 `medium`을 명시). 안전 분류기 거절에 대비해 서버 측 대체(`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`. `LLM_REFUSAL_FALLBACK=off`로 끔). 과금 근거는 `usage.iterations`(대체 시도 포함, 시도마다 그 모델 단가), 없으면 최상위 `usage`. SDK 재시도 `LLM_MAX_RETRIES`(2), 요청 타임아웃 `LLM_TIMEOUT_MS`(5분). 비스트리밍이라 출력 상한은 16,000토큰(더 필요한 기능은 스트리밍으로 바꾼 뒤에). 구조화 출력이 받지 않는 조건(글자 수·최솟값·개수·정규식)은 `toLlmJsonSchema`가 걷어 내고 응답을 받은 뒤 zod로 검사(PLANDIT-26에서 발견, troubleshooting 13)
  - 모의 구현: 네트워크 없음. JSON 스키마를 주면 스키마에 맞는 표본을, 아니면 고정 문장을 돌려준다. e2e는 다음 응답·오류·대기를 미리 넣어 둔다
- [x] 환산표(`packages/shared/ai.ts`): 모델별 100만 토큰당 크레딧(입력·출력·캐시 읽기·캐시 쓰기). 1크레딧 = 10원, 표시 가격(USD) × 1,400원 ÷ 10, 마진 없음. 호출 한 번의 크레딧 = 시도별 합을 **올림**(토큰을 썼으면 최소 1). 표에 없는 모델을 설정하면 기동 실패
- [x] `AiUsage`(workspaceId, userId, feature `SCHEDULE_ASSISTANT / MEMORY_SEARCH / TRIP_PLANNER`, status `RESERVED → CALLING → SUCCEEDED / FAILED`, provider, model, maxOutputTokens, estimatedCredits, credits, 토큰 4종, attempts jsonb, failureCode, latencyMs, debit·adjust·refund ledgerId, createdAt·startedAt·finishedAt)
- [x] `AiUsageService`(기능은 이것만 부른다)
  - `reserve(input, tx?)`: 선차감액 = 입력 토큰 추정(UTF-8 바이트 ÷ 2, 넉넉하게) + `maxOutputTokens`를 `servingModels` 중 가장 비싼 단가로. `AiUsage` RESERVED + DEBIT(`"AI_USAGE:{id}:DEBIT"`)을 한 트랜잭션(호출자 트랜잭션에 합류 가능). 잔액 부족이면 409 `INSUFFICIENT_CREDITS`, 행 없음
  - `execute(id, request, { parse, onSuccess?, onFailure? })`: `RESERVED → CALLING`을 조건부 UPDATE로 **먼저 기록**(동시에 두 번 불려도 LLM은 한 번) → LLM 호출(트랜잭션 밖) → 거절·잘림·`parse` 실패는 실패 처리 → 성공이면 행 `FOR UPDATE` → `min(실사용, 선차감)`을 청구하고 차액은 ADJUST(`"AI_USAGE:{id}:ADJUST"`, +) → SUCCEEDED + `onSuccess(tx)`를 한 트랜잭션. 선차감을 넘는 실사용은 청구하지 않는다(사용자가 본 금액이 상한)
  - `fail(id, code, { tx?, onFailure? })`: 끝나지 않은 건이면 REFUND(`"AI_USAGE:{id}:REFUND"`, 선차감 전액) + FAILED + `onFailure(tx)`. 이미 끝났으면 아무것도 하지 않는다. 실패한 호출의 토큰도 기록한다(청구는 0)
  - `run(input, hooks)`: `reserve` + `execute`(동기 호출용, PLANDIT-21)
- [x] 멈춘 사용 건 정리: `AI_USAGE_STALE_MS`(30분 — `LLM_TIMEOUT_MS` 5분 × (재시도 2 + 1)보다 길게)를 넘긴 RESERVED(생성 시각 기준)·CALLING(호출 시작 기준)은 워커 주기 작업(`AI_USAGE_RECONCILE_EVERY_MS`)이 FAILED(`STALE`) + 환불. 그 뒤에 돌아온 호출은 행이 CALLING이 아니므로 정산하지 않는다. 운영자 즉시 실행 `POST /admin/jobs/ai-usage-reconcile?minAgeMs=`
- [x] `GET /workspaces/:workspaceId/ai-usages`(ADMIN+, cursor·최신순, status·feature 필터)
- [x] 지표: `plandit_ai_calls_total{provider, outcome}`, `plandit_ai_tokens_total{model, kind}`, `plandit_ai_call_duration_seconds`, `plandit_ai_usages_unsettled{status}`. 런북에 "G. AI 사용 건이 정산되지 않는다"
- [x] `pnpm --filter @plandit/api llm:smoke`: 설정된 `LlmClient`로 짧은 구조화 출력 요청 한 번 → 모델·토큰·환산 크레딧 출력(크레딧은 움직이지 않음. `anthropic`이면 실제 API 호출 1회). 실제 키 확인용
- **완료 조건**: ✅
  - 단위: 환산(모델별 단가, 올림, 최소 1, 시도별 합산), 선차감(가장 비싼 모델 단가, 캐시 쓰기 단가 포함), Claude 어댑터(로컬 가짜 HTTP 서버): 요청 본문(모델·max_tokens·effort·json_schema·fallbacks·beta 헤더), 텍스트·stop_reason 변환, `usage.iterations` 합산, 오류 분류(400·401·429·500·529·타임아웃), 모의 구현의 스키마 표본
  - e2e(실제 Postgres, 모의 `LlmClient`): 성공 → DEBIT 1 + ADJUST 1, 잔액 = 처음 − 청구 / 실사용이 선차감을 넘음 → 선차감만 청구, ADJUST 없음 / LLM 오류·거절·잘림·`parse` 실패 → REFUND 전액, 잔액 원래대로, 토큰 기록 / 잔액 부족 409, 행 0, LLM 호출 0회 / 같은 건 `execute` 두 번·동시 두 번 → LLM 1회, 원장 그대로 / `onSuccess`가 던지면 정산이 롤백되고 환불 / 멈춘 건 정리 → FAILED + REFUND 1행(두 번 돌려도 1행), 늦게 돌아온 호출은 정산 안 함 / 호출자 트랜잭션에 합류한 `reserve`는 호출자가 롤백하면 DEBIT도 없음 / 불변식: 사용 건마다 `DEBIT + ADJUST + REFUND = −credits`, 원장 합계 = 잔액 / 목록 MEMBER 403·다른 워크스페이스 404·cursor

### PLANDIT-26 · AI 여행 일정 만들기
양식으로 목적지·기간·함께 갈 멤버를 받으면 AI가 날짜별 여행 일정 초안을 만들고, 사용자가 확인·수정한 뒤 캘린더에 한 번에 넣는다.
채팅으로 초안 고치기("둘째 날 오후는 쉬게 해줘")는 PLANDIT-21에서 같은 초안에 붙인다. **선행: PLANDIT-20**(`LlmClient`·Claude 어댑터·`ai_usages`·예상 선차감 → 정산).
- [x] 입력 스키마(`packages/shared/trips.ts`): calendarId, destination(1~80자), startDate·endDate(`YYYY-MM-DD`, 최대 7일), attendeeUserIds(0~20명, 본인 제외), pace(`RELAXED / NORMAL / PACKED`), interests(관광·맛집·휴식·쇼핑·액티비티 복수 선택), request(자유 요청 500자 이하)
- [x] 출력 스키마(같은 파일): `{ timezone, days: [{ date, items: [{ title, startTime "HH:mm", endTime "HH:mm", location?, description?, category: MOVE / MEAL / SIGHT / STAY / FREE }] }], notes? }`, 하루 최대 10개. 이 zod 스키마를 구조화 출력(`output_config.format`)으로 준다(Opus 5.5는 강제 `tool_choice`가 400이라 도구로 받지 않음). 구조화 출력이 받지 않는 조건(글자 수·최솟값·개수·정규식)은 `toLlmJsonSchema`가 걷어 내고, 응답을 원래 zod 스키마로 다시 검증
- [x] 서버 추가 검증: 날짜가 요청 기간 안, 종료 > 시작(자정을 넘는 항목 없음), timezone이 IANA 이름(`Intl.supportedValuesOf("timeZone")`). 어기면 FAILED(`INVALID_OUTPUT`) + 전액 환불, 화면에서 "다시 만들기"(자동 재요청은 하지 않음 — 재요청마다 과금되는 호출이 하나 더 생기므로)
- [x] 참석자: 대상 캘린더가 속한 **워크스페이스의 멤버**만(밖이면 400 `ATTENDEE_NOT_ELIGIBLE`, details에 userId 목록). 개인 캘린더는 참석자 없음. 일정 목록은 캘린더 멤버에게만 보이므로(`events.controller.ts` list — 이 규칙은 바꾸지 않는다), 캘린더 멤버가 아닌 참석자는 **적용할 때 그 캘린더에 VIEWER로 자동 추가**한다
  - 자동 추가는 요청자가 그 캘린더의 OWNER / ADMIN일 때만(기존 초대와 같은 기준, `getManageableCalendar`). EDITOR는 이미 캘린더 멤버인 사람만 고를 수 있고, 아니면 403(생성·수정·적용 모두)
  - 이미 캘린더 멤버면 역할을 바꾸지 않는다. 초대 API는 역할을 덮어쓰지만 여기서는 없는 사람만 넣는다(`createMany` + `skipDuplicates` — 그사이 초대로 들어온 사람도 역할 유지)
  - VIEWER가 되면 그 캘린더의 다른 일정(공개 범위 CALENDAR)도 보이므로, 적용 요청은 새로 추가할 사람 목록 `newCalendarMemberIds`를 **명시적으로** 보낸다. 서버가 계산한 목록과 다르면(그사이 누가 멤버가 됐거나 떠남) 409 `CALENDAR_MEMBERS_CHANGED`(details에 서버 목록), 아무것도 바꾸지 않음 → 화면이 다시 확인받음
  - 캘린더 멤버 변경은 기존에도 감사 로그 대상이 아니므로 기록하지 않는다(워크스페이스 멤버·역할 변경이 아님)
- [x] LLM에는 인원 수(본인 포함)만 보낸다. 멤버 이름·이메일은 보내지 않는다
- [x] `TripPlan`(workspaceId, calendarId, createdById, requestKey(unique(createdById, requestKey)), input jsonb, draft jsonb, status `GENERATING → READY / FAILED`, `READY → APPLIED`, failureCode, aiUsageId, addedCalendarMemberIds, appliedAt) + `Event.tripPlanId`(null 허용) 마이그레이션
- [x] API `/workspaces/:workspaceId/trip-plans`(워크스페이스 멤버만, 캘린더가 이 워크스페이스 소속이 아니면 404)
  - `POST`(`Idempotency-Key` 헤더 필수 — 두 번 눌러도 초안·차감 1건): 대상 캘린더 쓰기 권한(OWNER / ADMIN / EDITOR) 확인 → `TripPlan` GENERATING **선기록** + `AiUsage` + 예상 크레딧 DEBIT(`"AI_USAGE:{aiUsageId}:DEBIT"`)을 한 트랜잭션(잔액 부족이면 409 `INSUFFICIENT_CREDITS`, 행·LLM 호출 없음) → 큐 작업 `trip-plan.generate` 등록 → 202
  - `GET /options?calendarId=`(양식 준비: 함께 갈 수 있는 멤버와 `selectable`, 기간별 최대 크레딧, 잔액), `GET /:id`(상태 폴링), `GET`(내 초안 목록, cursor·최신순), `PATCH /:id`(READY 초안의 항목·참석자 교체, 같은 스키마로 검증)
  - `POST /:id/apply`(body `newCalendarMemberIds`): 초안 행 `FOR UPDATE` → 이미 APPLIED면 만든 일정을 그대로 돌려줌(목록 대조 없이 — 재시도·동시 적용이 409가 되지 않게) → 캘린더 쓰기 권한·참석자 자격 **다시 확인**(초안을 만든 뒤 바뀌었을 수 있음) → 새로 추가할 멤버 목록 대조 → 캘린더 멤버 VIEWER 추가 + 일정 N건(공개 범위 CALENDAR, `tripPlanId`) + 일정마다 참석자(userId·email·name, NEEDS_ACTION) → APPLIED(`addedCalendarMemberIds` 기록), 한 트랜잭션
  - `DELETE /:id/events`: 이 초안으로 만든 일정만 삭제(되돌리기)하고 초안은 READY로 돌아간다. 자동 추가한 캘린더 멤버는 남긴다(그사이 다른 일정에 참여했을 수 있음). 빼려면 기존 캘린더 멤버 관리에서
  - 남의 초안·다른 워크스페이스는 404, 캘린더 쓰기 권한 없음 403. 새 `ErrorCode`: `ATTENDEE_NOT_ELIGIBLE`(400), `CALENDAR_MEMBERS_CHANGED`(409)
- [x] 워커 `trip-plan.generate`: GENERATING일 때만 실행(재시도해도 LLM 결과는 한 번만 반영) → `LlmClient` 호출(`LLM_TIMEOUT_MS`) → 검증 → READY + 실사용 정산(`"AI_USAGE:{aiUsageId}:ADJUST"`). LLM 오류·타임아웃·검증 실패 → FAILED + 환불(`"AI_USAGE:{aiUsageId}:REFUND"`). 초안 상태는 AI 사용 건을 따른다: `AiUsageService.onFeatureFailure("TRIP_PLANNER")`가 모든 실패 경로(멈춘 건 정리 포함)의 환불 트랜잭션 안에서 GENERATING 초안을 FAILED로 바꾼다(별도 정리 작업·설정값 없음). 동시성 `TRIP_PLAN_CONCURRENCY`
- [x] 시각 변환: 현지 날짜·시각 + timezone → UTC로 저장(서머타임 반영). 일정에는 시간대 필드가 없어 보는 사람 기준 시각으로 표시되므로, 캘린더 시간대와 다르면 설명 첫 줄에 현지 시각(`현지 10:00–12:00 · Europe/Paris`)을 적는다
- [x] web: 새 일정 시트 머리에 "AI 여행 일정" 버튼 → `Sheet` 양식(목적지, 기간, 캘린더 `Picker`, 워크스페이스 멤버 선택 — 캘린더 멤버가 아닌 사람 옆에 "캘린더에 추가돼요", 요청자가 EDITOR면 그 사람은 흐리게 + "캘린더 관리자만 새 멤버와 함께 갈 수 있어요") → 예상 크레딧 표시 → 만드는 중(폴링) → 날짜별 미리보기(항목 끄기, 제목·시간 수정) → 새 멤버가 있으면 확인("A님, B님이 이 캘린더에 보기 권한으로 추가돼요. 이 캘린더의 다른 일정도 볼 수 있어요") → "캘린더에 N개 추가" → 완료 토스트 + "되돌리기"(되돌려도 "캘린더 멤버는 그대로예요"). 409 `CALENDAR_MEMBERS_CHANGED`면 새 목록으로 다시 확인. 미리보기에 "AI가 만든 초안이에요. 영업시간·휴무일은 한 번 더 확인해 주세요". 375px 먼저, 새 오류 코드는 `lib/client-api.ts`에서 한국어로. 끝나지 않은 초안은 기억해 두고 시트를 다시 열면 이어서 보여준다(닫아도 선차감한 크레딧이 버려지지 않게). web 프록시가 `Idempotency-Key` 헤더를 api로 넘긴다
- **완료 조건**: ✅
  - 단위: 출력 검증(기간 밖 날짜, 종료 ≤ 시작, 하루 항목 초과, 잘못된 시간대), 현지 시각 → UTC(`Europe/Paris` 서머타임 시작일 포함), 예상 크레딧 계산
  - e2e(모의 `LlmClient` + 실제 BullMQ 워커): 생성 → READY → 적용 → 일정 N건·참석자 N×M행 / 같은 `Idempotency-Key`로 생성 두 번 → 초안·DEBIT 1건 / 적용 두 번·동시 적용 2건 → 일정 N건 유지 / 되돌리기 → 그 초안의 일정만 삭제 / VIEWER 403 / 다른 워크스페이스 캘린더·남의 초안 404 / 워크스페이스 밖 사용자를 참석자로 → 400 / 초안 뒤 참석자가 워크스페이스를 떠남 → 적용 400 / **자동 추가**: 캘린더 OWNER가 캘린더 밖 워크스페이스 멤버와 적용 → 그 멤버가 VIEWER로 추가되고 그 계정의 일정 목록에 N건 / 이미 EDITOR인 멤버는 EDITOR 유지 / 적용 두 번 → 캘린더 멤버 행 1건 / EDITOR인 요청자가 캘린더 밖 멤버를 고름 → 403 / `newCalendarMemberIds`가 서버 목록과 다름 → 409, 멤버·일정 0건 / 되돌리기 → 일정만 삭제, 추가된 멤버는 남음 / 잔액 부족 409, LLM 호출 0회 / LLM 오류·스키마 위반·타임아웃 → FAILED + 전액 환불 / 불변식 `선차감(DEBIT) = 실사용 + 되돌려준 크레딧(ADJUST·REFUND)`
  - 개발 서버(모의 AI): 375px·1440px에서 만들기 → 미리보기(항목 빼기·고치기) → 캘린더에 넣기 → 되돌리기 토스트, 가로 스크롤 없음. 함께 가는 멤버 계정에 보이는지는 e2e(그 계정의 일정 목록)로 확인
- **결정**: 캘린더 멤버가 아닌 참석자는 적용 때 그 캘린더에 VIEWER로 자동 추가한다(검토한 다른 안: 참석자에게는 캘린더 멤버가 아니어도 그 일정만 보이게 일정 목록 조건을 바꾸기 — 기존 권한 모델을 바꾸므로 택하지 않음)

## 3주차 — 규모·운영 (개요)

- PLANDIT-30 리마인더 대량 발송 k6: 중계사 초당 제한 하에 처리량 측정, 병목 개선(배치 INSERT, 워커 동시성) 전후 기록을 `docs/perf.md`에
- PLANDIT-31 결제 취소·환불(APPROVED만, 잔액 ≥ 지급 크레딧일 때)
- PLANDIT-32 월 정산 배치 + 워크스페이스별 사용량 통계 API
- PLANDIT-33 잔액 기준 자동충전(빌링키, 모의 PG billing API)
- PLANDIT-34 파일 업로드 인프라(MinIO presigned URL) + 대용량 CSV·ICS 일정 가져오기(스트리밍 파싱, 10만 행 기준 메모리 상한 측정, 행별 오류 리포트)
- PLANDIT-35 OpenAPI로 타입 SDK(`packages/sdk`) 생성, web이 SDK로 API 호출
- PLANDIT-36 Google 캘린더 실제 연동: OAuth 토큰 갱신, `syncToken` 증분 동기화, 변경 알림(푸시 채널) 웹훅
