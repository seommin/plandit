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
