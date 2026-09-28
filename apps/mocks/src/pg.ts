import { Router } from "express";

import type { Db } from "./db.ts";
import { escapeHtml, newId, page, sendWebhook } from "./webhook.ts";

export type PgConfig = {
  publicUrl: string;
  webhookUrl: string;
  webhookSecret: string;
  /** Scenario 02: how long confirm takes to answer. */
  slowMs: number;
  /** Scenario 04: how long before the webhook goes out. */
  webhookDelayMs: number;
};

type Tx = {
  tx_id: string;
  merchant_trade_id: string;
  amount: number;
  scenario: string;
  status: "READY" | "APPROVED" | "FAILED" | "CANCELED";
  method: string | null;
  failure_code: string | null;
  return_url: string;
  webhook_url: string;
  created_at: Date;
  approved_at: Date | null;
  canceled_at: Date | null;
};

/** Last two digits of the amount pick the scenario. Anything unlisted behaves like 00. */
export const SCENARIOS: Record<string, string> = {
  "00": "정상 승인",
  "01": "승인 실패(카드 거절)",
  "02": "confirm 응답 지연(타임아웃 유도)",
  "03": "웹훅 2회 전송(같은 eventId)",
  "04": "웹훅 지연 전송",
  "05": "웹훅 전송 안 함",
};

const scenarioOf = (amount: number) => String(amount % 100).padStart(2, "0");
const isHttpUrl = (value: unknown) => typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toDto = (tx: Tx) => ({
  txId: tx.tx_id,
  merchantTradeId: tx.merchant_trade_id,
  amount: tx.amount,
  status: tx.status,
  method: tx.method,
  failureCode: tx.failure_code,
  scenario: tx.scenario,
  approvedAt: tx.approved_at,
  canceledAt: tx.canceled_at,
});

export function pgRouter(db: Db, config: PgConfig) {
  const router = Router();

  const find = async (txId: string) =>
    (await db.query<Tx>("SELECT * FROM mock.pg_transactions WHERE tx_id = $1", [txId])).rows[0];

  /** Records an event and delivers it according to the scenario (twice, late, or never). */
  async function emit(tx: Tx, type: "APPROVED" | "FAILED" | "CANCELED") {
    const eventId = newId("evt");
    const payload = {
      eventId,
      txId: tx.tx_id,
      merchantTradeId: tx.merchant_trade_id,
      type,
      amount: tx.amount,
      method: tx.method,
      failureCode: tx.failure_code,
      occurredAt: new Date().toISOString(),
    };
    await db.query("INSERT INTO mock.pg_events (event_id, tx_id, type, payload) VALUES ($1, $2, $3, $4)", [
      eventId,
      tx.tx_id,
      type,
      payload,
    ]);

    const times = tx.scenario === "05" ? 0 : tx.scenario === "03" ? 2 : 1;
    const delay = tx.scenario === "04" ? config.webhookDelayMs : 0;
    // ponytail: in-process timer, a restart drops pending webhooks — that is what the resend endpoint and
    // the merchant's re-query job are for.
    setTimeout(async () => {
      for (let i = 0; i < times; i++) await deliver(eventId, tx.webhook_url, payload);
    }, delay);
  }

  async function deliver(eventId: string, url: string, payload: unknown) {
    const status = await sendWebhook(url, config.webhookSecret, payload);
    await db.query(
      "UPDATE mock.pg_events SET sent_count = sent_count + 1, last_http_status = $2 WHERE event_id = $1",
      [eventId, status],
    );
    return status;
  }

  /** READY → APPROVED/FAILED exactly once; concurrent clicks and retries get the settled row back. */
  async function approve(txId: string) {
    const tx = await find(txId);
    if (!tx) return undefined;
    const declined = tx.scenario === "01";
    const { rows } = await db.query<Tx>(
      `UPDATE mock.pg_transactions
       SET status = $2, method = $3, failure_code = $4, approved_at = CASE WHEN $2 = 'APPROVED' THEN now() END
       WHERE tx_id = $1 AND status = 'READY' RETURNING *`,
      [txId, declined ? "FAILED" : "APPROVED", declined ? null : "CARD", declined ? "CARD_DECLINED" : null],
    );
    if (!rows[0]) return find(txId);
    await emit(rows[0], rows[0].status === "APPROVED" ? "APPROVED" : "FAILED");
    return rows[0];
  }

  router.post("/v1/payments/reserve", async (req, res) => {
    const { merchantTradeId, amount, returnUrl, webhookUrl } = req.body ?? {};
    if (
      typeof merchantTradeId !== "string" ||
      !/^[\w-]{1,64}$/.test(merchantTradeId) ||
      !Number.isInteger(amount) ||
      amount < 100 ||
      amount > 10_000_000 ||
      !isHttpUrl(returnUrl) ||
      (webhookUrl !== undefined && !isHttpUrl(webhookUrl))
    ) {
      res.status(400).json({ code: "VALIDATION_FAILED", message: "merchantTradeId, amount(100~10,000,000), returnUrl are required." });
      return;
    }

    const existing = (
      await db.query<Tx>("SELECT * FROM mock.pg_transactions WHERE merchant_trade_id = $1", [merchantTradeId])
    ).rows[0];
    if (existing) {
      if (existing.amount !== amount) {
        res.status(409).json({ code: "DUPLICATE_TRADE_ID", message: "merchantTradeId already used with another amount." });
        return;
      }
      res.status(200).json({ txId: existing.tx_id, paymentPageUrl: `${config.publicUrl}/pg/pay/${existing.tx_id}`, status: existing.status });
      return;
    }

    const txId = newId("tx");
    await db.query(
      `INSERT INTO mock.pg_transactions (tx_id, merchant_trade_id, amount, scenario, status, return_url, webhook_url)
       VALUES ($1, $2, $3, $4, 'READY', $5, $6)`,
      [txId, merchantTradeId, amount, scenarioOf(amount), returnUrl, webhookUrl ?? config.webhookUrl],
    );
    res.status(201).json({ txId, paymentPageUrl: `${config.publicUrl}/pg/pay/${txId}`, status: "READY" });
  });

  router.post("/v1/payments/:txId/confirm", async (req, res) => {
    const tx = await approve(req.params.txId);
    if (!tx) {
      res.status(404).json({ code: "NOT_FOUND", message: "Unknown txId." });
      return;
    }
    if (tx.scenario === "02") await sleep(config.slowMs);
    res.json(toDto(tx));
  });

  router.post("/v1/payments/:txId/cancel", async (req, res) => {
    const { rows } = await db.query<Tx>(
      `UPDATE mock.pg_transactions SET status = 'CANCELED', canceled_at = now()
       WHERE tx_id = $1 AND status = 'APPROVED' RETURNING *`,
      [req.params.txId],
    );
    if (!rows[0]) {
      const tx = await find(req.params.txId);
      res.status(tx ? 409 : 404).json(
        tx ? { code: "NOT_CANCELABLE", message: `Status is ${tx.status}.` } : { code: "NOT_FOUND", message: "Unknown txId." },
      );
      return;
    }
    await emit(rows[0], "CANCELED");
    res.json(toDto(rows[0]));
  });

  router.get("/v1/payments/:txId", async (req, res) => {
    const tx = await find(req.params.txId);
    if (!tx) res.status(404).json({ code: "NOT_FOUND", message: "Unknown txId." });
    else res.json(toDto(tx));
  });

  /** Lookup by the merchant's own id, for when the reserve response itself was lost. */
  router.get("/v1/payments", async (req, res) => {
    const { rows } = await db.query<Tx>("SELECT * FROM mock.pg_transactions WHERE merchant_trade_id = $1", [
      String(req.query.merchantTradeId ?? ""),
    ]);
    if (!rows[0]) res.status(404).json({ code: "NOT_FOUND", message: "Unknown merchantTradeId." });
    else res.json(toDto(rows[0]));
  });

  router.post("/v1/admin/webhooks/:eventId/resend", async (req, res) => {
    const { rows } = await db.query<{ payload: unknown; webhook_url: string }>(
      `SELECT e.payload, t.webhook_url FROM mock.pg_events e JOIN mock.pg_transactions t USING (tx_id)
       WHERE e.event_id = $1`,
      [req.params.eventId],
    );
    if (!rows[0]) {
      res.status(404).json({ code: "NOT_FOUND", message: "Unknown eventId." });
      return;
    }
    res.json({ eventId: req.params.eventId, httpStatus: await deliver(req.params.eventId, rows[0].webhook_url, rows[0].payload) });
  });

  // --- Hosted payment page (what the end user sees) ---

  const backTo = (tx: Tx, status: string, code?: string) => {
    const url = new URL(tx.return_url);
    url.searchParams.set("txId", tx.tx_id);
    url.searchParams.set("merchantTradeId", tx.merchant_trade_id);
    url.searchParams.set("status", status);
    if (code) url.searchParams.set("code", code);
    return url.toString();
  };

  router.get("/pay/:txId", async (req, res) => {
    const tx = await find(req.params.txId);
    if (!tx) {
      res.status(404).send(page("결제", "<h1>결제 정보를 찾을 수 없습니다</h1>"));
      return;
    }
    const actions =
      tx.status === "READY"
        ? `<form method="post" action="/pg/pay/${escapeHtml(tx.tx_id)}/approve"><button class="primary">결제 승인</button></form>
           <form method="post" action="/pg/pay/${escapeHtml(tx.tx_id)}/cancel"><button class="ghost">결제 취소</button></form>`
        : `<p>이미 처리된 결제입니다 (${escapeHtml(tx.status)}).</p><a href="${escapeHtml(backTo(tx, tx.status))}">가맹점으로 돌아가기</a>`;
    res.send(
      page(
        "모의 결제",
        `<h1>모의 결제</h1><p class="muted">실제 결제가 일어나지 않는 테스트 PG입니다.</p>
         <div class="card">
           <div class="row"><span>주문번호</span><span>${escapeHtml(tx.merchant_trade_id)}</span></div>
           <div class="row"><span>결제 금액</span><strong>${tx.amount.toLocaleString("ko-KR")}원</strong></div>
           <div class="row"><span>시나리오</span><span class="badge">${escapeHtml(tx.scenario)} · ${escapeHtml(SCENARIOS[tx.scenario] ?? SCENARIOS["00"])}</span></div>
         </div>${actions}`,
      ),
    );
  });

  router.post("/pay/:txId/approve", async (req, res) => {
    const tx = await approve(req.params.txId);
    if (!tx) res.status(404).send(page("결제", "<h1>결제 정보를 찾을 수 없습니다</h1>"));
    else res.redirect(303, backTo(tx, tx.status, tx.failure_code ?? undefined));
  });

  router.post("/pay/:txId/cancel", async (req, res) => {
    const { rows } = await db.query<Tx>(
      `UPDATE mock.pg_transactions SET status = 'FAILED', failure_code = 'USER_CANCELED'
       WHERE tx_id = $1 AND status = 'READY' RETURNING *`,
      [req.params.txId],
    );
    if (rows[0]) await emit(rows[0], "FAILED");
    const tx = rows[0] ?? (await find(req.params.txId));
    if (!tx) res.status(404).send(page("결제", "<h1>결제 정보를 찾을 수 없습니다</h1>"));
    else res.redirect(303, backTo(tx, tx.status, tx.failure_code ?? undefined));
  });

  router.get("/admin", async (_req, res) => {
    const { rows } = await db.query<Tx & { events: number; sent: number }>(
      `SELECT t.*, COUNT(e.*)::int AS events, COALESCE(SUM(e.sent_count), 0)::int AS sent
       FROM mock.pg_transactions t LEFT JOIN mock.pg_events e USING (tx_id)
       GROUP BY t.tx_id ORDER BY t.created_at DESC LIMIT 50`,
    );
    const body = rows
      .map(
        (t) => `<tr><td>${escapeHtml(t.merchant_trade_id)}</td><td>${t.amount.toLocaleString("ko-KR")}</td>
                <td><span class="badge">${escapeHtml(t.status)}</span></td><td>${escapeHtml(t.scenario)}</td><td>${t.sent}/${t.events}</td></tr>`,
      )
      .join("");
    res.send(
      page(
        "모의 PG 거래",
        `<h1>모의 PG 거래 (최근 50건)</h1><table><tr><th>주문번호</th><th>금액</th><th>상태</th><th>시나리오</th><th>웹훅 발송/이벤트</th></tr>${body}</table>`,
      ),
    );
  });

  return router;
}
