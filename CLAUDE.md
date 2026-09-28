# Plandit — 팀 캘린더 + 리마인더 발송 + 크레딧 과금 + AI 일정 비서

포트폴리오 프로젝트. 이미 동작하는 캘린더 웹앱(개인·공유 캘린더, 초대, 공유 링크, 웹 푸시) 위에
**워크스페이스 권한, 크레딧 원장, 결제, 큐 기반 리마인더 발송, LLM Tool Calling·RAG**를 얹는다.
**실제 결제와 실제 문자 발송은 없다.** 모의 외부 서버(`apps/mocks`)가 PG·문자 중계사 역할을 하며 진짜처럼 HTTP 콜백을 보낸다.

설계 문서: `docs/ERD.md`(추가·변경 데이터 모델), `docs/PLAN.md`(이슈 목록·설계 결정), `docs/PRODUCT_MODEL.md`(캘린더 도메인).
작업 전에 해당 이슈의 완료 조건을 읽는다.

## 스택·실행

- Node 24, pnpm 11 워크스페이스, TypeScript 6, NestJS 11, Next.js 16, Prisma 7(adapter-pg), PostgreSQL 18(pgvector), Redis 7, BullMQ
- 구조: `apps/web`(Next.js·Auth.js), `apps/api`(NestJS, HTTP 진입점 `main.ts` + 워커 진입점 `worker.ts`), `apps/mocks`(모의 PG·중계사), `packages/database`(Prisma), `packages/shared`(zod 스키마·상수)
- 실행: `docker compose up -d postgres redis` → `pnpm prisma:migrate` → `pnpm dev`(web :3000, api :4000, worker, mocks :4100)
- Swagger: http://localhost:4000/docs
- 검증: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`. 넷 다 통과해야 커밋한다.
- `.env`는 커밋하지 않는다. `.env.example`에 키를 추가하면 설명을 함께 적는다.

## 인증 흐름 (기존 유지)

- 로그인은 `apps/web`의 Auth.js. web 서버가 `x-api-secret` + `x-user-id` 헤더로 api를 호출한다(`InternalApiGuard`).
- 외부에서 api로 직접 들어오는 경로는 웹훅(`/webhooks/*`)뿐이며 `@Public()`으로 내부 시크릿 검사를 건너뛰고 **서명으로** 인증한다.

## 구조 규칙

- 새 도메인은 모듈 단위: `workspace`, `credit`, `payment`, `reminder`, `ai`, `audit`, `common`. 모듈 안은 `controller → service`, Prisma 호출은 service에서.
- 기존 컨트롤러(`calendar`, `events`, `shares`, `push`, `auth`)는 Prisma를 직접 부른다. 손대는 이슈에서만 service로 옮기고, 일부러 대규모 리팩터링하지 않는다.
- 입력 검증은 `packages/shared`의 zod 스키마(기존 방식 유지). Swagger는 `ApiZodBody(schema)`(zod → `z.toJSONSchema`), 검증은 `ZodPipe(schema)`.
- 외부 서비스(PG·중계사·LLM)는 인터페이스(`PaymentGateway`, `MessageProvider`, `LlmClient`) 뒤에 둔다. 구현체는 환경변수로 고른다. 실제 PG를 붙여도 service 코드는 바뀌지 않아야 한다.
- 오류 응답은 `common`의 `ApiError` 하나(`{ code, message, details?, traceId }`). 새 오류 유형은 `ErrorCode` enum에 추가.
- 스키마 변경은 Prisma 마이그레이션으로만. 운영 데이터를 지우는 마이그레이션은 만들지 않는다.
- 새로 만드는 목록 API는 페이지네이션(cursor)과 정렬을 갖는다.

## 돈에 관한 규칙 (가장 중요)

- **잔액을 직접 UPDATE하지 않는다.** 크레딧 변동은 전부 `LedgerService.append()`를 거친다. 원장(`credit_ledger`)은 append-only이고 `balance_after`를 함께 기록한다. `credit_accounts.balance`는 원장에서 파생된 캐시다.
- 원장 기록은 반드시 `idempotency_key`를 받는다. 같은 키로 두 번 부르면 두 번째는 기존 행을 돌려주고 아무것도 바꾸지 않는다.
- 잔액 변경은 `SELECT … FOR UPDATE`로 계정 행을 잠근 트랜잭션 안에서만. 애플리케이션 코드에서 `잔액 - 금액`을 계산해 넣지 않는다.
- **외부 호출 전에 내부 상태를 먼저 기록한다.** PG 호출 전 `payments`를 `RESERVE`로, 중계사 호출 전 `reminder_deliveries`를 `QUEUED`로 저장한 뒤 호출한다.
- 웹훅은 서명(HMAC-SHA256)을 검증하고 `event_id`를 유니크로 저장해 중복 수신을 걸러낸다. 이벤트 저장과 원장 기록은 같은 트랜잭션이다.
- 정합성 불변식: 유료 채널 리마인더에 대해 `차감 크레딧 = 성공 건 차감 + 실패 건 환불`. e2e로 항상 확인한다.

## 권한 규칙

- 워크스페이스 역할 `OWNER > ADMIN > MEMBER`(`WorkspaceRole.covers`). 역할 게이트는 `@Roles()` + `RolesGuard`, 경로는 `/workspaces/:workspaceId/...`로 통일.
- 캘린더 역할(`OWNER/ADMIN/EDITOR/VIEWER`)은 기존대로 캘린더 단위 데이터 권한이다. 워크스페이스 역할은 결제·크레딧·멤버 관리 권한이다. 둘을 섞지 않는다.
- 권한 없는 리소스 조회는 404(존재 여부 노출 안 함), 권한 부족 행위는 403.
- 워크스페이스 멤버·역할·결제·크레딧 변경은 `AuditService.record()`로 감사 로그를 남긴다.

## 모의 서버 규칙

- `apps/mocks`는 api의 코드를 import하지 않는다. HTTP로만 통신한다.
- 시나리오는 데이터로 제어한다. PG: 금액 끝 두 자리. 중계사: 수신번호 끝자리·환경변수(실패율·지연·초당 제한).
- 모의 서버는 자기 테이블(`mock_*`)에 거래·발송 내역을 남긴다.

## 테스트 규칙

- 단위: 원장 계산, 서명 검증, 역할 판정, 상태 전이, 리마인더 시각 계산. 외부 의존은 mock.
- e2e: 실제 Postgres·Redis(docker). 필수 시나리오는 `docs/PLAN.md` 각 이슈의 완료 조건에 있다.
- 실패 시나리오(웹훅 중복, 응답 유실, 잔액 부족, 권한 없음)는 성공 시나리오만큼 중요하다.

## 브랜치·커밋

- `main` 직접 커밋 금지. 이슈마다 `feat/PLANDIT-<번호>-<요약>` 브랜치. 한 브랜치에 한 이슈.
- Conventional Commits: `feat(credit): …`, `fix(payment): …`, `test(reminder): …`, `docs: …`.
- 이슈를 끝내면 `docs/PLAN.md`의 체크박스를 채우고, 설계를 바꿨으면 같은 커밋에서 문서를 고친다.

## 하지 않는 것

- 실제 PG 키, 실제 전화번호, 실제 API 키를 코드나 시드에 넣지 않는다. 시드 전화번호는 `010-0000-xxxx` 대역만.
- 이전 회사의 코드·데이터·API 규격을 가져오지 않는다. 도메인 이해만 가져온다.
- 요구사항이 모호하면 추측으로 구현하지 말고 `docs/PLAN.md`의 해당 이슈에 "확인 필요"로 적고 멈춘다.
