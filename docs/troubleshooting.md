# 트러블슈팅 기록

개발하면서 실제로 겪은 문제를 **증상 → 원인 → 해결 → 재발 방지** 순서로 남깁니다.

## 1. 문자 리마인더 429 재시도가 한꺼번에 몰린다

- **증상**: 수신자 100명 e2e(중계사 초당 25건 제한)에서 발송 작업 105개 중 72개가 재시도, 최대 7회 시도. 재시도가 같은 시각에 몰려 다시 429를 받는 모습
- **원인**: BullMQ 지수 백오프(1s, 2s, 4s…)를 지터 없이 쓰면, 같은 순간 429를 받은 작업들이 **같은 순간 다시** 요청한다
- **해결**: 백오프에 `jitter: 0.5`를 추가해 재시도 시각을 흩뜨림(`reminder.queue.ts`)
- **재발 방지**: e2e에 "재시도가 실제로 일어났고, 그 속에서도 `차감 = 성공 + 환불`이 맞는다"를 검증으로 남김. 운영에서는 `plandit_jobs_total{name="send",outcome="failed"}`로 관찰

## 2. 개발 서버를 재시작했는데 옛 코드가 작업을 처리한다

- **증상**: 코드를 고치고 `pnpm dev`를 다시 띄웠는데 리마인더 동작이 이전 그대로
- **원인**: 워커는 포트를 열지 않아서, 포트 기준으로 프로세스를 정리할 때 **이전 워커가 살아남았다**. 두 워커가 같은 Redis 큐를 나눠 소비
- **해결**: 명령줄(`worker.ts`)로 프로세스를 찾아 종료
- **재발 방지**: 워커가 여러 대 떠도 결과가 틀리지 않도록 설계되어 있음(발송 건 unique, 원장 멱등키, `QUEUED` 조건부 갱신) — 이번에도 데이터는 틀리지 않았다. 다만 "어떤 코드가 돌고 있는지"는 워커 `/metrics`(`WORKER_METRICS_PORT`)로 확인하도록 런북에 추가

## 3. 기존 데이터가 있는 테이블에 NOT NULL 컬럼을 추가할 수 없다

- **증상**: `Calendar.workspaceId`(필수) 추가 시 `prisma migrate dev`가 "3개 행이 있어 실행할 수 없음"
- **원인**: 기본값 없는 NOT NULL 컬럼은 기존 행을 채울 수 없다
- **해결**: 한 마이그레이션 안에서 **nullable 추가 → 사용자별 개인 워크스페이스 생성·백필 → NOT NULL** 3단계로 직접 작성. 적용 전 `pg_dump`로 백업
- **재발 방지**: 마지막 `SET NOT NULL`이 "OWNER가 없는 캘린더"가 있으면 실패하도록 두어, 데이터가 조용히 잘못 채워지지 않게 함

## 4. `@nestjs/swagger` 최신 버전이 설치되지 않는다(peer 불일치)

- **증상**: `pnpm add @nestjs/swagger` → 12.x 설치, `pnpm peers check`에서 `@nestjs/common ^12` 요구
- **원인**: 최신 메이저가 NestJS 12를 전제
- **해결**: `@nestjs/swagger@11`로 고정. 모든 의존성은 정확한 버전으로 고정(`save-exact`)
- **재발 방지**: 의존성 추가 후 `pnpm peers check`를 확인하는 습관

## 5. TypeScript 6에서 테스트 파일 타입 검사 실패

- **증상**: `describe`, `expect`를 찾을 수 없다는 오류가 테스트 파일에서만 발생
- **원인**: TS 6부터 `@types/*` 자동 포함이 기본으로 꺼짐
- **해결**: `tsconfig.json`에 `"types": ["node", "jest"]` 명시

## 6. Windows Git Bash의 curl로 보낸 한글이 깨진다

- **증상**: 가상 수신함에 `����`로 저장된 문자
- **원인**: 서버가 아니라 **클라이언트**. Git Bash가 `curl -d '한글'`의 인자를 CP949 바이트로 넘김. 서버는 UTF-8로 해석
- **해결**: 본문을 UTF-8 JSON 파일로 저장해 `--data-binary @file`로 전송. `apps/mocks/README.md`에 주의사항 추가
- **재발 방지**: 자동 테스트는 모두 `fetch`(UTF-8)로 보내 영향 없음을 확인

## 7. 패키지 매니저가 설정 파일에 자리표시 값을 넣었다

- **증상**: `pnpm-workspace.yaml`의 `allowBuilds`에 `msgpackr-extract: set this to true or false`가 그대로 커밋됨
- **원인**: 빌드 스크립트가 있는 의존성(BullMQ의 선택 의존성)을 설치할 때 pnpm이 자리표시를 추가
- **해결**: `false`로 명시(네이티브 가속 없이도 동작)
- **재발 방지**: 의존성 추가 커밋은 lockfile 외 설정 파일 diff도 확인

## 8. 브랜치를 오갈 때 마이그레이션 SQL의 줄바꿈이 바뀐다

- **증상**: 이미 적용한 `migration.sql`이 작업 폴더에서 CRLF로 바뀜(`core.autocrlf=true`)
- **원인**: Git이 체크아웃할 때 LF를 CRLF로 변환
- **확인**: Prisma가 체크섬을 비교할 때 줄바꿈 차이는 문제 삼지 않음(`migrate status` 정상)을 확인하고 그대로 둠

## 9. 버튼의 글자색·굵기 클래스가 적용되지 않는다

- **증상**: 검정 버튼(`bg-primary text-on-primary`)의 글자가 배경과 같은 검정으로 나와 보이지 않음. 선택된 칩이 글자 없는 검은 덩어리로 보임
- **원인**: `globals.css`의 `button { color: inherit; font: inherit }`가 레이어 밖에 있었음. CSS 캐스케이드 레이어 규칙상 레이어 밖 스타일이 Tailwind 유틸리티(`@layer utilities`)보다 항상 이김
- **해결**: 요소 기본값(html·body·button·`:focus-visible`)을 `@layer base { … }` 안으로 옮김. 전역 CSS에 요소 선택자를 추가할 때는 반드시 `@layer base` 안에 둔다

## 10. 한글이 Pretendard가 아니라 시스템 글꼴(맑은 고딕)로 나온다

- **증상**: 영문·숫자만 Pretendard이고 한글은 맑은 고딕. 굵은 글씨가 뭉개져 보임
- **원인**: `@fontsource/pretendard`는 **라틴 글자만**, 기본 import는 **400 굵기만** 들어 있음. 한글과 600·700 굵기는 대체 글꼴·가짜 굵게로 그려짐
- **해결**: 패키지를 지우고 Pretendard 공식 가변 글꼴의 dynamic subset CSS를 `<head>`에서 불러옴(유니코드 범위별로 쪼개져 있어 화면에 나온 글자만 받음). `pretendard` npm 패키지는 OTF·TTF까지 들어 있어 97MB라 쓰지 않음

## 11. 머지하고 나면 개발 서버가 이전 버전 화면을 내준다

- **증상**: 브랜치를 main에 머지·push한 뒤 브라우저에 **직전 버전** 스타일이 나옴(주말 색이 사라지는 등 고친 것이 되돌아간 것처럼 보임). 디스크의 `globals.css`는 최신인데 서버가 내려주는 CSS는 옛 내용. 세 번 반복됨
- **원인**: 머지를 `git checkout main && git merge --no-ff 브랜치`로 했음. `checkout main`이 작업 폴더에 **옛 파일**을 쓰고, 곧바로 `merge`가 **새 파일**을 다시 씀. 개발 서버(Turbopack) 파일 감시가 첫 번째 쓰기만 읽고 두 번째를 놓쳐 옛 내용을 들고 있었음
- **해결**: 개발 서버를 재시작(프로세스 정리는 2번과 같이 명령줄 기준)
- **재발 방지**: 개발 서버가 떠 있는 동안에는 작업 폴더를 옛 버전으로 되돌리지 않고 머지한다. 기능 브랜치가 main에서 갈라진 뒤 main이 그대로면 아래처럼 커밋만 만들고 main을 옮긴다(`--no-ff` 머지와 같은 결과, 파일은 한 번도 바뀌지 않음)
  ```bash
  git commit-tree -p main -p 브랜치 -m "Merge branch '브랜치'" 브랜치^{tree}   # 출력된 커밋 id를 아래에
  git update-ref refs/heads/main <커밋 id> && git checkout main                 # 트리가 같아 파일 변화 없음
  ```
  서버 CSS가 새것인데 화면만 옛것이면 브라우저 캐시이므로 `Ctrl+Shift+R`

## 12. 새로 받은 폴더에서 `pnpm seed:demo`가 `PrismaClient`를 못 찾는다

- **증상**: 저장소를 새로 받아 `pnpm install` → `pnpm prisma:migrate` → `pnpm seed:demo`를 하면 `Module '"@prisma/client"' has no exported member 'PrismaClient'`로 실패. 원래 쓰던 폴더에서는 문제없음
- **원인**: Prisma 7부터 `prisma migrate dev`가 클라이언트 생성(`prisma generate`)을 자동으로 하지 않고, 설치 때도 만들지 않음. 원래 폴더에는 예전에 만든 클라이언트가 남아 있어서 드러나지 않았음
- **해결**: 루트 `package.json`에 `"postinstall": "pnpm --filter @plandit/database prisma:generate"`. 설치할 때마다 클라이언트를 만든다(설정 파일에 기본 DB 주소가 있어 `.env`가 없어도 된다)
- **재발 방지**: README 실행 절차는 새로 받은 폴더에서 처음부터 따라 해서 확인한다(PLANDIT-10 완료 조건 확인 때 발견)
- **같은 원인, 다른 모습**(PLANDIT-20): 스키마에 모델을 추가하고 `pnpm prisma:migrate`로 마이그레이션까지 적용했는데, api 타입 검사가 `Property 'aiUsage' does not exist`로 실패. 설치가 끝난 뒤의 스키마 변경은 postinstall이 다시 돌지 않으므로 `pnpm --filter @plandit/database prisma:generate`를 직접 실행한다

## 13. AI 구조화 출력에 zod 스키마를 그대로 넘기면 조건이 거절된다

- **증상**: 여행 일정 형식(`tripDraftSchema`)을 `z.toJSONSchema`로 바꿔 모델에 주면 `minLength`·`maxLength`·`minimum`·`maximum`·`pattern`·`minItems`가 그대로 들어간다. Claude 구조화 출력(`output_config.format`)의 문서에는 글자 수·숫자 범위·배열 개수 조건이 "지원하지 않음"으로 적혀 있어서, 실제 키로 부르면 요청이 거절(400 → `LLM_BAD_REQUEST`)되고 모든 초안이 환불로 끝날 수 있었다. 모의 모델은 형식을 검사하지 않아서 테스트로는 드러나지 않았고, 구현 중 문서를 확인하다 발견했다
- **원인**: SDK의 `messages.parse()` 도우미는 이런 조건을 알아서 걷어 내지만, 우리는 공급자를 바꿀 수 있게 `messages.create()`에 JSON 스키마를 직접 넘긴다(PLANDIT-20)
- **해결**: `toLlmJsonSchema`가 지원되는 키워드(type·properties·required·items·enum·const·anyOf·description, 지원 format)만 남기고 모든 객체에 `additionalProperties: false`를 붙인다. 걷어 낸 조건은 응답을 받은 뒤 원래 zod 스키마로 검사한다(`parseDraft`). 선택 항목은 `optional` 대신 `nullable`로 둬서 모든 키를 `required`에 넣는다
- **재발 방지**: `llm-client.spec.ts`가 변환 결과를 통째로 비교한다. 모의 모델은 네트워크를 타지 않아 이 문제를 못 잡으므로, 새 형식을 추가하면 `pnpm --filter @plandit/api llm:smoke`처럼 실제 키로 한 번 확인한다

## 14. 웹에서 보낸 `Idempotency-Key`가 api에 닿지 않는다

- **증상**: 여행 초안 "만들기"를 두 번 누르면 초안이 두 개 생길 수 있는 구조였다. api는 `Idempotency-Key` 헤더로 중복을 막는데, 브라우저 요청을 api로 넘기는 web 프록시(`lib/api-client.ts`의 `proxyInternalApi`)가 content-type·IP·기기 헤더만 옮겨 담고 나머지는 버리고 있었다
- **해결**: 프록시가 `idempotency-key`도 넘긴다. 화면은 양식 내용이 같으면 같은 키를 쓰고(두 번 눌러도, 연결이 끊겨 다시 보내도 초안·차감 1건), "다시 만들기"에서만 새 키를 만든다
- **재발 방지**: 헤더로 멱등성을 받는 API를 새로 만들면 프록시를 거친 요청으로 한 번 확인한다(e2e는 api를 직접 부르므로 이 경로를 지나지 않는다)

## 15. 서버와 보는 사람의 시간대가 다르면 캘린더 첫 화면이 어긋난다

- **증상**: 개발 서버(UTC)에 한국 시간 브라우저로 접속하면 캘린더 첫 화면에서 "Hydration failed because the server rendered HTML didn't match the client"가 나고 화면을 통째로 다시 그렸다. UTC 브라우저로는 재현되지 않았다. 원인을 찾다가 코드에서 더 큰 문제를 발견했다: 한국 시간 10월 1일 새벽 5시(서버는 아직 9월 30일)에 열면 서버가 **9월** 화면의 일정을 넘기고, 브라우저는 그걸 10월 화면의 첫 데이터로 그대로 써서 10월 4일 오전 9시 이후 일정이 다른 달로 넘어갔다 올 때까지 빠진다(고친 뒤 브라우저 시계를 그 시각으로 맞춰 10월 일정을 다시 가져오는 것을 확인)
- **원인**: 캘린더 화면(클라이언트 컴포넌트)도 서버에서 한 번 그려지는데, "오늘"·보이는 달·일정이 놓일 시각을 `new Date()`와 지역 시각 함수로 계산한다. 서버 프로세스의 시간대(UTC)와 브라우저의 시간대가 다르면 두 결과가 다르다. 서버가 넘기는 첫 데이터의 기간도 서버 시간대의 달이었고, 브라우저는 기간을 확인하지 않고 첫 요청을 건너뛰었다
- **해결**: 시간대에 따라 달라지는 캘린더는 브라우저에서만 그리고, 서버와 수화(hydration) 중의 첫 화면은 같은 뼈대를 그린다(`components/use-hydrated.ts`). 서버는 앞뒤 하루 여유를 두고 가져온 기간을 `range`로 함께 넘기고, 브라우저는 자기 기간을 다 덮을 때만 첫 요청을 건너뛴다(`rangeCovers`)
- **재발 방지**: 서버와 다른 시간대의 브라우저로 확인한다(Playwright `timezoneId: "Asia/Seoul"`, 서버는 UTC). `TZ=Asia/Seoul`로 서버 시간대를 맞추는 방법은 한국 밖 사용자에게 같은 문제가 남아서 택하지 않았다

## 16. 빌드한 api(`dist`)를 `node`로 띄우면 `@plandit/*`·`@prisma/adapter-pg`를 못 찾는다

- **증상**: 배포용으로 `nest build` 결과를 `node dist/apps/api/src/main.js`로 실행하면 공용 패키지(`@plandit/shared/…`, `@plandit/database/…`)를 불러오다 실패하고, 그걸 넘기면 `Error: Cannot find module '@prisma/adapter-pg'`(require 경로: `dist/packages/database/src/prisma.js`). 개발 실행(`pnpm dev`)은 문제없음
- **원인**: 공용 패키지는 빌드 단계 없이 TypeScript 원본을 그대로 내보낸다. 개발 실행은 TS를 직접 읽어서 괜찮지만, 빌드한 api는 `node_modules/@plandit/*`의 `.ts` 원본을 가리키게 된다. `nest build`가 공용 패키지의 컴파일본을 `dist/packages/*`에 같이 만들지만 Node는 그 위치를 모른다. 게다가 그 컴파일본은 `apps/api/dist` 밑에 있어서, pnpm이 `packages/database/node_modules`에만 둔 `@prisma/adapter-pg`를 찾지 못한다
- **해결**: `apps/api/register-dist.cjs`를 `node -r`로 먼저 불러, `@plandit/*`를 `dist/packages/*` 컴파일본으로 연결하고(tsconfig-paths) 공용 패키지의 `node_modules`를 모듈 검색 경로(`NODE_PATH`)에 더한다. `pnpm start`·`start:worker`와 운영 compose가 모두 이 방식으로 띄운다
- **재발 방지**: 배포 구성을 바꾸면 도커 이미지를 실제로 빌드해 띄워 본다(`docs/deploy.md`의 구성을 `DOMAIN=localhost`로 로컬에서 확인)

## 17. `node:24-bookworm-slim` 이미지에서는 Prisma 마이그레이션 엔진이 돌지 않는다

- **증상**: 이미지를 작게 하려고 slim을 쓰면 Prisma 마이그레이션 엔진이 쓰는 OpenSSL 라이브러리(`libssl.so.3`)가 없다(slim 이미지에서 `libssl` 파일 0개 확인). 설치하려면 `apt-get install openssl`이 필요한데, 이 작업 환경의 네트워크는 운영체제 패키지 저장소를 막아 두어 apt 단계가 403으로 실패했다
- **해결**: 기본 이미지를 `node:24-bookworm`(slim 아님)으로 바꿨다. `libssl.so.3`과 인증서가 이미 들어 있어 apt 단계가 없다. 이미지는 커지지만 서버 한 대에 이미지 하나라 감수한다
- **덤**: 회사망처럼 TLS를 가로채는 프록시 뒤에서 빌드하면 `pnpm install`이 인증서 오류를 낸다. `Dockerfile`은 선택 비밀값 `extra_ca`가 있으면 `NODE_EXTRA_CA_CERTS`로 쓴다(`docker build --secret id=extra_ca,src=<CA 묶음 파일>`). 일반 서버에서는 넘기지 않는다

## 18. GitHub Actions에서 `actions/setup-node@v5`가 `Unable to locate executable file: pnpm`으로 멈춘다

- **증상**: 처음 올린 CI가 설치 단계 전에 실패. 로그에 `package-manager-cache: true`와 위 오류
- **원인**: setup-node v5는 `package.json`의 `packageManager`를 보고 그 도구의 캐시를 자동으로 켠다. 우리는 pnpm을 corepack으로 그다음 단계에서 켜서, 그 시점엔 pnpm이 없다
- **해결**: `package-manager-cache: false`로 끄고, pnpm 저장소는 `actions/cache`로 따로 캐시한다(`pnpm store path`)

## 19. 웹 개발 서버가 11시간쯤 지나면 메모리 부족으로 죽는다

- **증상**: `pnpm dev`를 켜 두면 웹 개발 서버(`next dev`)가 `JavaScript heap out of memory`(종료 코드 134)로 멈추고, 같은 명령으로 띄운 api·워커·모의 서버도 함께 내려감. 두 번 모두 약 11시간 뒤 힙 16GB에서 멈췄고, 그동안 웹 요청은 10건뿐이었음 — 요청이 아니라 **시간에 비례해** 늘어남(시간당 약 1.4GB)
- **원인**: Next.js 16.2.x 개발 서버(Turbopack)의 메모리 누수. 컴파일한 결과를 프로세스가 끝날 때까지 메모리에 쥐고 있음. 16.3에서 쓰지 않는 경로를 디스크로 내리는 방식으로 고쳐짐. 우리 코드에는 서버 쪽 반복 타이머가 없음을 확인
- **해결**: `next`를 16.3.7로 올림(React 19·next-auth 5 베타와 호환 확인). 같은 조건(캘린더 화면을 연 채 가만히)에서 10분 측정: 16.2.7은 959MB → 1,275MB로 계속 증가, 16.3.7은 415MB → 405MB로 그대로
- **버전 고르기**: 최신 16.3.8은 공개된 지 1시간 반이라 pnpm 11의 공급망 보호(새 버전은 하루가 지나야 설치, `minimumReleaseAge`)에 걸렸고, 설치 명령이 `pnpm-workspace.yaml`에 예외(`minimumReleaseAgeExclude`)를 스스로 추가했음. 예외를 되돌리고 하루가 지난 16.3.7을 골랐다. 설치 뒤에는 `pnpm-workspace.yaml`에 예외가 생기지 않았는지 꼭 확인한다
- **같이 겪은 실수**: 웹 서버만 죽고 api·워커·모의 서버가 살아 있는 상태에서 `pnpm dev`를 다시 실행 → 새 api가 `EADDRINUSE`로 실패하고 옛 api가 대신 응답함. 다시 띄우기 전에 2번처럼 명령줄로 남은 프로세스를 먼저 정리한다
- 운영(`next start`)은 개발 서버가 아니므로 이 누수와 무관하지만, 배포 후 메모리 지표로 확인한다(PLANDIT-11)
