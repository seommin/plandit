# Plandit

개인 일정과 팀 일정을 함께 관리하는 캘린더 웹앱입니다. 공유 캘린더, 멤버 초대, 공개 일정 링크, 웹 푸시를 지원하고,
그 위에 워크스페이스 권한 · 크레딧 원장 · 결제 · 큐 기반 리마인더 발송 · AI 일정 비서를 얹고 있습니다.

작업 계획과 진행 상황은 [docs/PLAN.md](docs/PLAN.md), 데이터 모델은 [docs/ERD.md](docs/ERD.md)에 있습니다.

## 기술 스택

- Node.js `24` · pnpm `11` 워크스페이스 · TypeScript `6.0.3`
- NestJS `11.1.9` · Next.js `16.2.7` · React `19.2.7` · Tailwind CSS `4.3.0`
- PostgreSQL `18` + pgvector · Prisma ORM `7.4.0`
- Redis `7.4` (BullMQ 큐)
- Auth.js / NextAuth `5.0.0-beta.31`
- 테스트: Jest(@swc/jest) · Supertest, 린트: ESLint

## 프로젝트 구조

```txt
apps/web              Next.js 웹앱 — 화면, Auth.js 세션 처리
apps/api              NestJS API 서버 — 캘린더·일정·공유·워크스페이스·크레딧
apps/mocks            모의 PG·문자 중계사 서버(실제 결제·발송 없음)
packages/database     Prisma 스키마, 마이그레이션, DB 연결
packages/shared       공용 zod 스키마와 상수
```

웹앱은 DB를 직접 읽지 않습니다. 모든 데이터는 API를 거칩니다.

```txt
Next.js web -> NestJS API -> Prisma -> PostgreSQL
```

## 실행 방법

```bash
pnpm install
cp .env.example .env
docker compose up -d          # postgres(pgvector) :5432, redis :6379
pnpm prisma:migrate
pnpm dev                      # web :3000, api :4000, worker(BullMQ), mocks :4100
```

- API 문서(Swagger): http://localhost:4000/docs
- 헬스 체크: http://localhost:4000/health
- 모의 PG·문자 중계사: http://localhost:4100 (사용법: [apps/mocks/README.md](apps/mocks/README.md)), 가상 수신함: http://localhost:4100/inbox
- 검증: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` (e2e는 `docker compose up -d` 필요. 별도 DB `plandit_test`를 사용)

## 기능 범위

캘린더
- 일정 관리: 캘린더, 일정, 참석자, 중요 일정 표시
- 개인 일정: 본인만 볼 수 있는 캘린더와 일정
- 공유 캘린더: 캘린더 멤버, 역할(OWNER/ADMIN/EDITOR/VIEWER), 초대 링크
- 일정 공유: 카카오톡이나 링크 복사로 보내는 공개 일정 페이지
- 푸시 알림: NestJS 프로바이더 인터페이스, 기본값은 외부 호출 없는 `NOOP`, Web Push 지원
- 가입: 이메일/비밀번호, 소셜 로그인(Google · Kakao · Naver, Auth.js)
- Google 캘린더 동기화, 홈·잠금 화면 위젯: 데이터 모델만 있고 기능은 아직 없음

백엔드 확장 (진행 중)
- 워크스페이스: 개인/팀 워크스페이스, 역할(OWNER > ADMIN > MEMBER), 모든 캘린더는 워크스페이스에 소속
- 크레딧 원장: 추가만 가능한 원장, 멱등키, 행 잠금, 동시 차감에도 잔액 정합성 보장
- 예정: 모의 PG 충전과 웹훅 멱등 처리, BullMQ 리마인더 발송(푸시·문자·알림톡), AI 일정 비서(Tool Calling·RAG)

개인/공유/공개 일정 모델은 [docs/PRODUCT_MODEL.md](docs/PRODUCT_MODEL.md)를 참고하세요.
