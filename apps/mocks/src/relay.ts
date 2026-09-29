import { Router } from "express";

import type { Db } from "./db.ts";
import { escapeHtml, newId, page, sendWebhook } from "./webhook.ts";

export type RelayConfig = {
  webhookUrl: string;
  webhookSecret: string;
  /** 0..1 chance that a valid number still fails (carrier error). */
  failRate: number;
  /** Time between accepting a message and reporting its result. */
  delayMs: number;
  /** Accepted requests per second; more → 429. */
  rps: number;
  random?: () => number;
};

type Message = {
  msg_id: string;
  client_ref: string | null;
  phone: string;
  kind: string;
  body: string;
  status: "ACCEPTED" | "DELIVERED" | "FAILED";
  fail_code: string | null;
  callback_url: string;
  event_id: string | null;
  created_at: Date;
  result_at: Date | null;
};

const KINDS = ["SMS", "LMS", "ALIMTALK"];
const isHttpUrl = (value: unknown) => typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value);

/** "010-0000-0001", "01000000001" → "01000000001"; anything else → null. */
export function normalizePhone(value: unknown) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[\s-]/g, "");
  return /^01\d{8,9}$/.test(digits) ? digits : null;
}

const formatPhone = (digits: string) => digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");

const toDto = (m: Message) => ({
  msgId: m.msg_id,
  clientRef: m.client_ref,
  to: formatPhone(m.phone),
  kind: m.kind,
  status: m.status,
  failCode: m.fail_code,
  acceptedAt: m.created_at,
  resultAt: m.result_at,
});

export function relayRouter(db: Db, config: RelayConfig) {
  const router = Router();
  const random = config.random ?? Math.random;

  // ponytail: fixed one-second window in memory, single process only. Enough to make callers handle 429.
  let windowStart = 0;
  let windowCount = 0;
  const allow = () => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      windowCount = 0;
    }
    return ++windowCount <= config.rps;
  };

  async function settle(msgId: string) {
    const { rows } = await db.query<Message>("SELECT * FROM mock.relay_messages WHERE msg_id = $1", [msgId]);
    const message = rows[0];
    if (!message || message.status !== "ACCEPTED") return;

    // Numbers ending in 9 are "wrong numbers"; otherwise the configured carrier failure rate applies.
    const failCode = message.phone.endsWith("9") ? "INVALID_NUMBER" : random() < config.failRate ? "CARRIER_ERROR" : null;
    const eventId = newId("evt");
    const { rows: settled } = await db.query<Message>(
      `UPDATE mock.relay_messages SET status = $2, fail_code = $3, event_id = $4, result_at = now()
       WHERE msg_id = $1 AND status = 'ACCEPTED' RETURNING *`,
      [msgId, failCode ? "FAILED" : "DELIVERED", failCode, eventId],
    );
    if (settled[0]) await deliver(settled[0]);
  }

  async function deliver(message: Message) {
    const httpStatus = await sendWebhook(message.callback_url, config.webhookSecret, {
      eventId: message.event_id,
      msgId: message.msg_id,
      clientRef: message.client_ref,
      to: formatPhone(message.phone),
      status: message.status,
      failCode: message.fail_code,
      occurredAt: message.result_at,
    });
    await db.query(
      "UPDATE mock.relay_messages SET sent_count = sent_count + 1, last_http_status = $2 WHERE msg_id = $1",
      [message.msg_id, httpStatus],
    );
    return httpStatus;
  }

  router.post("/v1/messages", async (req, res) => {
    const { to, body, kind = "SMS", callbackUrl, clientRef } = req.body ?? {};
    const phone = normalizePhone(to);
    if (
      !phone ||
      typeof body !== "string" ||
      body.length < 1 ||
      body.length > 2000 ||
      !KINDS.includes(kind) ||
      (callbackUrl !== undefined && !isHttpUrl(callbackUrl)) ||
      (clientRef !== undefined && (typeof clientRef !== "string" || clientRef.length > 128))
    ) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "to(010-xxxx-xxxx), body(1~2000), kind(SMS|LMS|ALIMTALK) are required." });
      return;
    }
    // Idempotent resend: a caller retrying after a lost response gets the original message, not a second SMS.
    const findByRef = async () =>
      clientRef
        ? (await db.query<Message>("SELECT * FROM mock.relay_messages WHERE client_ref = $1", [clientRef])).rows[0]
        : undefined;
    const existing = await findByRef();
    if (existing) {
      res.status(200).json({ msgId: existing.msg_id, status: existing.status });
      return;
    }
    if (!allow()) {
      res.set("retry-after", "1").status(429).json({ code: "RATE_LIMITED", message: `Over ${config.rps} requests per second.` });
      return;
    }

    const msgId = newId("msg");
    const inserted = await db.query(
      `INSERT INTO mock.relay_messages (msg_id, client_ref, phone, kind, body, status, callback_url)
       VALUES ($1, $2, $3, $4, $5, 'ACCEPTED', $6)
       ON CONFLICT (client_ref) WHERE client_ref IS NOT NULL DO NOTHING`,
      [msgId, clientRef ?? null, phone, kind, body, callbackUrl ?? config.webhookUrl],
    );
    if (!inserted.rowCount) {
      const winner = (await findByRef())!; // a concurrent request with the same clientRef got there first
      res.status(200).json({ msgId: winner.msg_id, status: winner.status });
      return;
    }
    // ponytail: in-process timer like the PG mock; lost results are recovered by the caller re-querying GET below.
    setTimeout(() => void settle(msgId), config.delayMs);
    res.status(202).json({ msgId, status: "ACCEPTED" });
  });

  router.get("/v1/messages/:msgId", async (req, res) => {
    const { rows } = await db.query<Message>("SELECT * FROM mock.relay_messages WHERE msg_id = $1", [req.params.msgId]);
    if (!rows[0]) res.status(404).json({ code: "NOT_FOUND", message: "Unknown msgId." });
    else res.json(toDto(rows[0]));
  });

  router.post("/v1/admin/webhooks/:eventId/resend", async (req, res) => {
    const { rows } = await db.query<Message>("SELECT * FROM mock.relay_messages WHERE event_id = $1", [req.params.eventId]);
    if (!rows[0]) res.status(404).json({ code: "NOT_FOUND", message: "Unknown eventId." });
    else res.json({ eventId: req.params.eventId, httpStatus: await deliver(rows[0]) });
  });

  return router;
}

/** Virtual inbox: what each (fake) phone number has received. */
export function inboxRouter(db: Db) {
  const router = Router();

  router.get("/", async (req, res) => {
    const raw = typeof req.query.phone === "string" ? req.query.phone : "";
    const phone = normalizePhone(raw);
    const { rows } = phone
      ? await db.query<Message>(
          "SELECT * FROM mock.relay_messages WHERE phone = $1 AND status = 'DELIVERED' ORDER BY result_at DESC LIMIT 100",
          [phone],
        )
      : { rows: [] as Message[] };

    const list = phone
      ? rows.length
        ? rows
            .map(
              (m) => `<div class="card"><div class="row"><span class="badge">${escapeHtml(m.kind)}</span>
                      <span class="muted">${escapeHtml(m.result_at?.toLocaleString("ko-KR"))}</span></div>
                      <p style="white-space:pre-wrap;margin:8px 0 0">${escapeHtml(m.body)}</p></div>`,
            )
            .join("")
        : `<p class="muted">${escapeHtml(formatPhone(phone))}로 도착한 문자가 없습니다.</p>`
      : raw
        ? `<p class="muted">전화번호 형식이 올바르지 않습니다.</p>`
        : "";

    res.send(
      page(
        "가상 수신함",
        `<h1>가상 수신함</h1><p class="muted">모의 중계사가 "발송 성공" 처리한 문자입니다. 실제 발송은 없습니다.</p>
         <form method="get"><input name="phone" placeholder="010-0000-0001" value="${escapeHtml(raw)}" inputmode="tel">
         <button class="primary">조회</button></form>${list}`,
      ),
    );
  });

  return router;
}
