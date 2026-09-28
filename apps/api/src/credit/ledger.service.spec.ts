import { ApiError } from "../common/api-error";
import { assertAmountSign } from "./ledger.service";

describe("assertAmountSign", () => {
  it.each([
    ["CHARGE", 10n],
    ["REFUND", 1n],
    ["DEBIT", -1n],
    ["ADJUST", 5n],
    ["ADJUST", -5n],
  ] as const)("accepts %s %s", (type, amount) => {
    expect(() => assertAmountSign(type, amount)).not.toThrow();
  });

  it.each([
    ["CHARGE", 0n],
    ["CHARGE", -10n],
    ["REFUND", -1n],
    ["DEBIT", 0n],
    ["DEBIT", 3n],
    ["ADJUST", 0n],
  ] as const)("rejects %s %s", (type, amount) => {
    expect(() => assertAmountSign(type, amount)).toThrow(ApiError);
  });
});
