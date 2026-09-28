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
- [x] 수동 조정: **플랫폼 운영자**(`PLATFORM_ADMIN_EMAILS`)만 — 워크스페이스 ADMIN이 스스로 크레딧을 만들 수 없게. memo·`Idempotency-Key` 헤더 필수. 감사 로그는 PLANDIT-8에서 연결
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
- 감사 로그 `payment.approved`, `payment.failed`는 PLANDIT-8에서 연결
- **완료 조건**: ✅ e2e(실제 모의 PG 프로세스를 띄워서 실행) — 정상(원장 1행, APPROVED) / 시나리오 `03` 중복(이벤트 1행, 원장 1행) / 잘못된 서명 401·변화 없음 / 다른 eventId로 APPROVED 재수신 → 이벤트 저장, 원장 1행 유지 / 금액 불일치 미반영 / `01` 실패 / PG 다운 → 502 + UNKNOWN / 권한·입력 검증. 개발 서버에서도 10,000원 충전 → 결제 페이지 승인 → 1,000크레딧 확인

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
- [ ] README: 공고 용어 대응표(조직 = 워크스페이스, 스페이스 = 캘린더, 권한 = 워크스페이스 역할 + 캘린더 역할), AI 개발 도구(Claude Code + CLAUDE.md 규칙)로 일한 방식 한 단락
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

### PLANDIT-13 · API 키 인증 + 요청 수 제한 [M]
채용공고의 "인증/권한"을 API 쪽에서 직접 보여주는 이슈. 2주차 MCP 서버와 외부 연동의 전제.
- [ ] `ApiKey`: workspace_id, user_id(발급자), name, prefix(표시용 앞 8자), key_hash(SHA-256, **원문은 발급 응답에서 한 번만** 노출), scopes(`events:read`, `events:write`, `credits:read`), expires_at, last_used_at, revoked_at
- [ ] 발급·목록·폐기 API: 본인 키는 본인이, 워크스페이스의 모든 키는 ADMIN 이상이 조회·폐기. 발급 스코프는 발급자 권한을 넘을 수 없음
- [ ] 공개 API `/v1/*`(일정 조회·생성, 크레딧 잔액): `Authorization: Bearer pk_…` → `ApiKeyGuard`(해시 조회, 만료·폐기 확인, 스코프 검사). 내부 시크릿 경로와 분리
- [ ] 요청 수 제한: 키별 Redis 카운터(`INCR` + `EXPIRE`), 초과 시 429 + `Retry-After`, 응답 헤더 `X-RateLimit-Limit/Remaining`
- [ ] 감사 로그 `api_key.created`, `api_key.revoked`
- **완료 조건**: e2e — 폐기·만료·잘못된 키 401(같은 본문), 스코프 없는 요청 403, 다른 워크스페이스 리소스 404, 한도 초과 429 + Retry-After, DB에 키 원문이 없음

### PLANDIT-14 · 모니터링 + 장애 대응 런북 [M]
채용공고의 "로깅, 모니터링, 장애 대응"에 대응.
- [ ] `/metrics`(Prometheus 형식, `prom-client`): 라우트·상태별 요청 수와 지연, BullMQ 큐 적체·실패 수, 웹훅 수신 결과(처리/중복/서명 실패), 원장 append 결과(성공/잔액 부족/멱등 재호출), 미확정 결제 수. 외부 비공개
- [ ] traceId를 큐 작업까지 전파(작업 payload에 포함) → 요청 하나를 api·worker 로그에서 끝까지 추적
- [ ] `docs/runbook.md`: 증상별 대응 — 웹훅 서명 실패 급증, 큐 적체, 원장·캐시 불일치, PG 응답 지연. 볼 지표, 로그 검색어, 복구 명령(재조회 강제 실행, `recalculate`, 웹훅 재전송)
- [ ] `docs/troubleshooting.md`: 개발 중 실제로 겪은 문제의 증상·원인·해결·재발 방지
- **완료 조건**: 시나리오 `05`(웹훅 유실) 재현 → 지표에서 미확정 결제 증가 확인 → 런북 절차대로 복구 → 지표 정상화

### 진행 순서
번호는 한 번 정하면 바꾸지 않는다. 1주차 진행 순서: 5 → 6 → 7 → 8 → 13 → 14 → 9 → 10 → 11 → 12

### 1주차 종료 기준
- PLANDIT-1~10, 13, 14 완료. e2e: 정상 충전 / 웹훅 중복 / 서명 오류 / 웹훅 유실 → 재조회 복구 / 동시 차감 50건 / 권한 403·404 / 리마인더 실패 환불 불변식 / API 키 401·403·429
- 이 시점에 지원

---

## 2주차 — AI 일정 비서 (개요)

- PLANDIT-20 `LlmClient` + Claude 어댑터, 토큰→크레딧 환산표, 예상 선차감(DEBIT) → 실사용 정산(ADJUST), `ai_usages`. 임베딩은 Anthropic API에 없으므로 별도 제공자(예: Voyage AI)를 `EmbeddingClient` 인터페이스 뒤에 둔다
- PLANDIT-21 **AI 에이전트(Tool Calling 루프)**: "다음 주에 팀 전원이 되는 시간에 회의 잡아줘" → 모델이 도구를 여러 단계 호출(`list_events` → `find_free_slots` → `create_event`). 최대 단계 수·크레딧 한도·타임아웃, 쓰기 도구는 **사용자 승인 후 실행**(승인 대기 상태 저장), 단계별 도구 호출·결과 기록
- PLANDIT-22 **RAG**: 일정(제목·설명·장소) + **회의록 파일(PDF·TXT) 업로드** → 텍스트 추출·청킹·임베딩(pgvector)은 큐 작업으로 비동기 처리(진행 상태 표시, 크기·형식 검증) → "지난달 A사 미팅에서 뭐 정했지?"에 근거 인용과 함께 답변. 권한 범위 밖 문서·일정은 검색 대상에서 제외
- PLANDIT-23 같은 도구를 **MCP 서버**로 노출(사용자 토큰 기반)
- PLANDIT-24 AI 권한·한도: 워크스페이스별 월 AI 크레딧 상한, LLM 실패 시 환불
- PLANDIT-25 README에 AI 데모 GIF

## 3주차 — 규모·운영 (개요)

- PLANDIT-30 리마인더 대량 발송 k6: 중계사 초당 제한 하에 처리량 측정, 병목 개선(배치 INSERT, 워커 동시성) 전후 기록을 `docs/perf.md`에
- PLANDIT-31 결제 취소·환불(APPROVED만, 잔액 ≥ 지급 크레딧일 때)
- PLANDIT-32 월 정산 배치 + 워크스페이스별 사용량 통계 API
- PLANDIT-33 잔액 기준 자동충전(빌링키, 모의 PG billing API)
- PLANDIT-34 파일 업로드 인프라(MinIO presigned URL) + 대용량 CSV·ICS 일정 가져오기(스트리밍 파싱, 10만 행 기준 메모리 상한 측정, 행별 오류 리포트)
- PLANDIT-35 OpenAPI로 타입 SDK(`packages/sdk`) 생성, web이 SDK로 API 호출
- PLANDIT-36 Google 캘린더 실제 연동: OAuth 토큰 갱신, `syncToken` 증분 동기화, 변경 알림(푸시 채널) 웹훅
