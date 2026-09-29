import { createHmac, timingSafeEqual } from "crypto";

/** Constant-time string comparison for secrets and signatures. */
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Webhook check: hex HMAC-SHA256 of the exact raw body bytes. */
export function isValidHmacSha256(rawBody: Buffer, signature: unknown, secret: string) {
  return typeof signature === "string" && safeEqual(signature, createHmac("sha256", secret).update(rawBody).digest("hex"));
}
