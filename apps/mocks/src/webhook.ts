import { createHmac, randomUUID } from "node:crypto";

export const SIGNATURE_HEADER = "x-mock-signature";

/** Hex HMAC-SHA256 over the exact raw body bytes that are sent. */
export function sign(secret: string, rawBody: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;

/** POSTs a signed JSON webhook. Never throws: returns the HTTP status, or 0 when the receiver is unreachable. */
export async function sendWebhook(url: string, secret: string, payload: unknown) {
  const rawBody = JSON.stringify(payload);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: sign(secret, rawBody) },
      body: rawBody,
      signal: AbortSignal.timeout(5_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function page(title: string, body: string) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, "Pretendard", sans-serif; }
  body { margin: 0; padding: 24px 16px; max-width: 480px; margin-inline: auto; }
  h1 { font-size: 20px; } .muted { opacity: .65; font-size: 14px; }
  .card { border: 1px solid #8884; border-radius: 12px; padding: 16px; margin: 12px 0; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; }
  button, input { font: inherit; min-height: 44px; border-radius: 10px; }
  button { width: 100%; border: 0; margin-top: 8px; cursor: pointer; }
  .primary { background: #2f6bff; color: white; } .ghost { background: #8882; color: inherit; }
  input { width: 100%; box-sizing: border-box; padding: 0 12px; border: 1px solid #8886; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; } td, th { padding: 6px 4px; border-bottom: 1px solid #8883; text-align: left; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #8883; }
</style></head><body>${body}</body></html>`;
}
