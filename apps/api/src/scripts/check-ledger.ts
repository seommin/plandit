/**
 * pnpm check:ledger — 원장과 잔액 캐시가 맞는지 검사한다. 읽기만 하고 아무것도 고치지 않는다.
 * 종료 코드: 0 이상 없음 · 1 불일치 발견 · 2 검사 자체를 못 함(DB 연결 실패 등).
 * 운영 서버: deploy/check-ledger.sh
 */
import { prisma } from "@plandit/database/prisma";

import { type LedgerIssue, LedgerCheckService } from "../credit/ledger-check.service";

const describe = (issue: LedgerIssue) =>
  issue.kind === "CACHE_MISMATCH"
    ? `잔액 캐시 불일치  계정 ${issue.accountId} (워크스페이스 ${issue.workspaceId}): 캐시 ${issue.cached}, 원장 합계 ${issue.ledgerSum}`
    : `${issue.kind === "NEGATIVE_BALANCE" ? "음수 잔액" : "잔액 연속성 깨짐"}  계정 ${issue.accountId} 원장 #${issue.ledgerId}: 기록 ${issue.actual}, 누계 ${issue.expected}`;

export async function checkLedger(print: (line: string) => void = console.log): Promise<0 | 1> {
  const { accounts, entries, issues, truncated } = await new LedgerCheckService().run();
  if (!issues.length) {
    print(`원장 검사: 계정 ${accounts}개, 원장 ${entries}행 — 이상 없음`);
    return 0;
  }
  print(`원장 검사: 계정 ${accounts}개, 원장 ${entries}행 — 문제 ${issues.length}건${truncated ? " 이상(앞부분만 표시)" : ""}`);
  for (const issue of issues) print(`  ${describe(issue)}`);
  print("대응: docs/runbook.md \"E. 잔액과 원장이 맞지 않는다\"");
  return 1;
}

if (require.main === module) {
  checkLedger()
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (error) => {
      console.error("원장 검사를 실행하지 못했어요:", error);
      await prisma.$disconnect();
      process.exit(2);
    });
}
