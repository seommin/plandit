import { z } from "zod";

/** 1 credit = 10 KRW (one SMS reminder costs 1 credit). */
export const CREDIT_UNIT_PRICE_KRW = 10;
export const CHARGE_MIN_KRW = 1_000;
export const CHARGE_MAX_KRW = 1_000_000;

/** Credits granted for a payment. Remainders below one credit (e.g. mock scenario amounts like 10,003) are dropped. */
export const creditsForAmount = (amountKrw: number) => Math.floor(amountKrw / CREDIT_UNIT_PRICE_KRW);

export const chargeSchema = z.object({
  amount: z.number().int().min(CHARGE_MIN_KRW).max(CHARGE_MAX_KRW),
});
