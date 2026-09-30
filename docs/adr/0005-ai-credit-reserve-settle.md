# 0005. AI 호출은 최대 금액을 먼저 잡고, 끝나면 쓴 만큼만 청구한다

- 상태: 채택 (PLANDIT-20)
- 관련 코드: `apps/api/src/ai/ai-usage.service.ts`, `apps/api/src/ai/anthropic.adapter.ts`, `packages/shared/src/ai.ts`

## 맥락

문자 한 통은 가격이 정해져 있지만(1크레딧), LLM 호출은 끝나기 전까지 값을 모른다. 입력·출력 토큰 수로 값이 정해지고, 사고(thinking) 토큰도 출력으로 과금된다.
게다가 한 번의 호출이 여러 모델을 거칠 수 있다. Claude Opus 5.5의 안전 분류기가 요청을 거절하면 서버 측 대체(`fallbacks: "default"`)가 같은 호출 안에서 다른 모델(Claude Opus 5, Opus 4.8)로 다시 돌리는데, 이 모델들은 토큰당 값이 더 비싸다.
호출은 몇 분 걸릴 수 있고, 그동안 워커가 죽을 수도 있다.

## 결정

1. **호출 전에 최대 금액을 선차감한다(DEBIT).** 입력은 UTF-8 바이트 ÷ 2로 넉넉히 어림하고 가장 비싼 입력 단가(캐시 쓰기)로, 출력은 `maxOutputTokens` 전체를 계산한다. 단가는 요청을 처리할 수 있는 모든 모델(`servingModels`: 설정 모델 + 대체 모델) 가운데 가장 비싼 값이다. 잔액이 모자라면 모델을 부르지 않는다.
2. **호출 직전에 `CALLING`을 기록한다.** `RESERVED → CALLING`을 조건부 UPDATE로 바꾼 쪽만 모델을 부른다. 같은 사용 건을 두 번(재시도, 동시 실행) 불러도 모델 호출은 한 번이다([0002](0002-reserve-before-external-call.md)와 같은 원칙).
3. **끝나면 실사용만 청구하고 나머지를 돌려준다(ADJUST +).** 실사용은 시도별(`usage.iterations`) 토큰을 그 시도 모델의 단가로 더해 올림한다. 청구액은 `min(실사용, 선차감)`이다. 어림이 빗나가 실사용이 더 커도 사용자가 본 금액이 상한이고, 차이는 플랫폼이 부담하며 로그에 남는다.
4. **실패하면 선차감 전액을 환불한다(REFUND).** LLM 오류, 거절, 출력 잘림, 기능의 응답 검증 실패, 정산 트랜잭션 실패가 모두 해당한다. 실패한 호출의 토큰도 기록한다(원가 추적용, 청구는 0).
5. **멈춘 건은 워커가 닫는다.** `AI_USAGE_STALE_MS`(30분, `LLM_TIMEOUT_MS` × (재시도 + 1)보다 길게)를 넘긴 `RESERVED`·`CALLING`은 `FAILED(STALE)` + 환불. 그 뒤에 돌아온 응답은 행이 `CALLING`이 아니므로 정산하지 않는다. LLM에는 PG처럼 다시 물어볼 조회 API가 없어서, 확인할 수 없는 건은 사용자에게 유리하게(환불) 닫는다.
6. **기능의 상태 변경과 정산은 한 트랜잭션이다.** `execute(..., { onSuccess(tx), onFailure(tx) })`로 기능(예: 여행 초안 READY)과 ADJUST·REFUND가 함께 커밋되거나 함께 롤백된다. `reserve(input, tx)`도 호출자 트랜잭션에 합류할 수 있다. 기능별 실패 처리(`onFeatureFailure(feature, handler)`)를 등록하면, 기능을 모르는 멈춘 건 정리 작업이 환불할 때도 같은 트랜잭션에서 기능 상태(여행 초안 FAILED)가 바뀐다.
7. 원장 멱등키는 `AI_USAGE:{id}:DEBIT / ADJUST / REFUND`. 사용 건마다 `DEBIT + ADJUST + REFUND = −credits`.

## 버린 대안

- **호출 후 실사용만 차감**: 잔액이 모자라도 모델을 먼저 부르게 되고, 호출 중 다른 요청이 같은 잔액을 써 버릴 수 있다. 잔액을 음수로 만들지 않는다는 원장 규칙과 맞지 않는다.
- **토큰 수를 미리 세고(`count_tokens`) 정확히 선차감**: 호출마다 네트워크 왕복이 하나 늘고, 출력·사고 토큰은 어차피 미리 셀 수 없다. 상한으로 잡고 돌려주는 편이 단순하다.
- **실사용이 선차감을 넘으면 추가 차감**: 사용자가 확인한 금액보다 더 나갈 수 있고, 추가 차감이 잔액 부족으로 실패하는 경우를 따로 다뤄야 한다.
- **도구 강제 호출(`tool_choice`)로 JSON 받기**: Claude Opus 5.5는 강제 `tool_choice`를 400으로 거절한다. 구조화 출력(`output_config.format`)을 쓴다.

## 결과

- 사용자는 호출 전에 최대 금액을 보고, 끝나면 대부분을 돌려받는다. 잔액은 항상 원장 합계와 같다.
- 확정되지 않은 건은 `plandit_ai_usages_unsettled`로 드러나고, 런북 G의 명령(`POST /admin/jobs/ai-usage-reconcile`)으로 즉시 닫을 수 있다.
- 대가: 선차감 동안 잔액이 일시적으로 크게 줄어 보인다. 출력 상한이 큰 기능일수록 두드러진다.

## 이 결정을 지키는 테스트

- `apps/api/src/ai/ai-credits.spec.ts`: 모델별 단가·올림·시도별 합산, 선차감이 어떤 대체 모델의 최악 청구보다 작지 않음
- `apps/api/src/ai/anthropic.adapter.spec.ts`: 대체 시도가 있으면 `usage.iterations`로 과금, 요청에 강제 `tool_choice`가 없음
- `apps/api/test/ai-usage.e2e-spec.ts`: 성공(DEBIT + ADJUST), 선차감 초과 시 선차감만 청구, 실패 4종 전액 환불, 잔액 부족 시 호출 0회, 동시 실행 5건 → 모델 호출 1회, 정산 롤백 시 환불, 멈춘 건 정리 후 늦은 응답은 청구 안 함, 사용 건마다 불변식
