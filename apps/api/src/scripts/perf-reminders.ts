import "reflect-metadata";

import { prisma } from "@plandit/database/prisma";

import { LedgerService } from "../credit/ledger.service";
import { fireAtFor } from "../reminder/reminder-time";
import { ReminderQueue } from "../reminder/reminder.queue";

/**
 * PLANDIT-30 load test: one event with PERF_RECIPIENTS attendees and one SMS reminder that fires a few seconds from
 * now, then watch the worker push it through the mock carrier (RELAY_RPS per second) and report send rate, delay,
 * failures, carrier calls and the money check. api (result webhooks), worker and mocks must run against the same
 * database — see docs/perf.md. Creates PERF_RECIPIENTS users, so it only runs on a database whose name ends in _perf.
 */
const N = Number(process.env.PERF_RECIPIENTS ?? 1000);
const LEAD_MS = 5_000;
const TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS ?? 10 * 60_000);
const MINUTES_BEFORE = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms: number) => Math.round(ms / 100) / 10;
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function setUp() {
  // 010-0000-xxxx test range only, skipping numbers ending in 9 (the mock carrier's "wrong number" scenario)
  const phones = Array.from({ length: 10_000 }, (_, i) => `0100000${String(i).padStart(4, "0")}`).filter((p) => !p.endsWith("9"));
  if (N < 1 || N > phones.length) throw new Error(`PERF_RECIPIENTS must be 1..${phones.length}.`);
  const people = phones.slice(0, N).map((phone, i) => ({ email: `perf-${i}@plandit.test`, name: `부하 ${i}`, phone }));
  await prisma.user.createMany({ data: people, skipDuplicates: true });
  const users = await prisma.user.findMany({ where: { email: { in: people.map((p) => p.email) } }, select: { id: true, email: true, name: true } });
  const owner = users.find((u) => u.email === "perf-0@plandit.test")!;

  const workspace = await prisma.workspace.create({
    data: { name: `부하 측정 ${new Date().toISOString()}`, type: "TEAM", members: { create: { userId: owner.id, role: "OWNER" } }, creditAccount: { create: {} } },
    include: { creditAccount: true },
  });
  await new LedgerService().append({
    accountId: workspace.creditAccount!.id,
    type: "CHARGE",
    amount: N,
    refType: "MANUAL",
    refId: "perf-reminders",
    idempotencyKey: `PERF:${workspace.id}:CHARGE`,
    memo: "부하 측정용 크레딧",
  });
  const calendar = await prisma.calendar.create({
    data: { workspaceId: workspace.id, name: "부하 측정", type: "SHARED", members: { create: { userId: owner.id, role: "OWNER" } } },
  });

  const startsAt = new Date(Date.now() + LEAD_MS + MINUTES_BEFORE * 60_000);
  const event = await prisma.event.create({
    data: { calendarId: calendar.id, createdById: owner.id, title: "전체 공지 회의", startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) },
  });
  await prisma.eventAttendee.createMany({ data: users.map((u) => ({ eventId: event.id, userId: u.id, email: u.email, name: u.name })) });
  const reminder = await prisma.eventReminder.create({
    data: { eventId: event.id, minutesBefore: MINUTES_BEFORE, channel: "SMS", audience: "ATTENDEES", createdById: owner.id },
  });
  return { reminderId: reminder.id, fireAt: fireAtFor(event, MINUTES_BEFORE, calendar.timezone) };
}

async function main() {
  if (!new URL(process.env.DATABASE_URL ?? "postgresql://x/x").pathname.endsWith("_perf")) {
    throw new Error("DATABASE_URL must point at a *_perf database (this script creates thousands of rows).");
  }
  const { reminderId, fireAt } = await setUp();
  const reminders = new ReminderQueue();
  await reminders.scheduleFire(reminderId, fireAt);
  console.log(`${N} recipients, fires at ${fireAt.toISOString()}`);

  for (;;) {
    await sleep(1_000);
    const counts = Object.fromEntries(
      (await prisma.reminderDelivery.groupBy({ by: ["status"], where: { reminderId }, _count: true })).map((c) => [c.status, c._count]),
    ) as Record<string, number>;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`+${seconds(Date.now() - fireAt.getTime())}s`, counts);
    if (total === N && !counts.QUEUED && !counts.SENT) break;
    if (Date.now() - fireAt.getTime() > TIMEOUT_MS) {
      console.warn("Timed out; reporting what finished.");
      break;
    }
  }

  const deliveries = await prisma.reminderDelivery.findMany({ where: { reminderId } });
  const sent = deliveries.filter((d) => d.sentAt).map((d) => d.sentAt!.getTime() - fireAt.getTime()).sort((a, b) => a - b);
  const failures: Record<string, number> = {};
  for (const d of deliveries) if (d.status !== "DELIVERED") failures[d.failCode ?? d.status] = (failures[d.failCode ?? d.status] ?? 0) + 1;

  // Carrier calls = paid send attempts, from the (fresh) worker's own counter: a 429 is a failed attempt BullMQ retries.
  // Not BullMQ's job records — it keeps only the last 1,000 finished jobs.
  const metrics = (await (await fetch(`http://localhost:${process.env.WORKER_METRICS_PORT}/metrics`)).text()).split("\n");
  const attempts = (outcome: string) =>
    Number(metrics.find((l) => l.startsWith("plandit_jobs_total{") && l.includes('queue="reminder-sends"') && l.includes(`outcome="${outcome}"`))?.split(" ").at(-1) ?? 0);
  const calls = attempts("completed") + attempts("failed");

  const ledger = await prisma.creditLedger.groupBy({
    by: ["type"],
    where: { refType: "REMINDER_DELIVERY", refId: { in: deliveries.map((d) => d.id) } },
    _count: true,
  });
  const entries = Object.fromEntries(ledger.map((l) => [l.type, l._count])) as Record<string, number>;
  const delivered = deliveries.filter((d) => d.status === "DELIVERED").length;
  const lastResult = Math.max(...deliveries.map((d) => d.resultAt?.getTime() ?? 0)) - fireAt.getTime();

  const report = {
    recipients: N,
    delivered,
    failures,
    // fire → every delivery row written QUEUED (one createMany) and its send job queued (one addBulk)
    fanOutSec: seconds(Math.max(...deliveries.map((d) => d.queuedAt.getTime())) - fireAt.getTime()),
    allDoneSec: seconds(lastResult),
    sendRatePerSec: sent.length > 1 ? Math.round((sent.length / ((sent.at(-1)! - sent[0]) / 1000)) * 10) / 10 : null,
    sendDelaySec: sent.length ? { p50: seconds(percentile(sent, 50)), p95: seconds(percentile(sent, 95)), max: seconds(sent.at(-1)!) } : null,
    carrierCalls: calls,
    retries: calls - deliveries.length,
    // every debit ends delivered or refunded: DEBIT = DELIVERED + REFUND
    money: { debits: entries.DEBIT ?? 0, refunds: entries.REFUND ?? 0, balanced: (entries.DEBIT ?? 0) === delivered + (entries.REFUND ?? 0) },
  };
  console.log(JSON.stringify(report, null, 2));
  await Promise.all([reminders.queue.close(), reminders.paidSends.close()]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
