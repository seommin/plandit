import { Controller, Get, Headers, Injectable, Module, type OnModuleDestroy, type OnModuleInit, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Queue } from "bullmq";
import { Gauge } from "prom-client";

import { prisma } from "@plandit/database/prisma";

import { ApiError, ErrorCode } from "../common/api-error";
import { Public } from "../common/public.decorator";
import { safeEqual } from "../common/safe-equal";
import { QUEUES, redisConnection } from "../queue/redis-connection";
import { register } from "./metrics";

const gauge = <L extends string>(name: string, help: string, labelNames: L[], collect: (g: Gauge<L>) => Promise<void>) =>
  register.getSingleMetric(name) ??
  new Gauge<L>({
    name,
    help,
    labelNames,
    async collect() {
      await collect(this);
    },
  });

/** Gauges read at scrape time from Postgres and Redis — the numbers the runbook looks at first. */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly queues = Object.values(QUEUES).map((name) => new Queue(name, { connection: redisConnection() }));

  onModuleInit() {
    gauge("plandit_payments_unsettled", "Payments not yet settled (RESERVE/UNKNOWN)", ["status"], async (g) => {
      const rows = await prisma.payment.groupBy({ by: ["status"], where: { status: { in: ["RESERVE", "UNKNOWN"] } }, _count: true });
      g.reset();
      for (const status of ["RESERVE", "UNKNOWN"]) g.set({ status }, rows.find((r) => r.status === status)?._count ?? 0);
    });
    gauge("plandit_payments_unsettled_oldest_seconds", "Age of the oldest unsettled payment (alert when > RECONCILE_MIN_AGE)", [], async (g) => {
      const oldest = await prisma.payment.findFirst({
        where: { status: { in: ["RESERVE", "UNKNOWN"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      g.set(oldest ? (Date.now() - oldest.createdAt.getTime()) / 1000 : 0);
    });
    gauge("plandit_reminder_deliveries_pending", "Deliveries waiting to be sent (QUEUED) or for a carrier result (SENT)", ["status"], async (g) => {
      const rows = await prisma.reminderDelivery.groupBy({ by: ["status"], where: { status: { in: ["QUEUED", "SENT"] } }, _count: true });
      g.reset();
      for (const status of ["QUEUED", "SENT"]) g.set({ status }, rows.find((r) => r.status === status)?._count ?? 0);
    });
    gauge("plandit_ai_usages_unsettled", "AI usages holding a reservation (RESERVED/CALLING)", ["status"], async (g) => {
      const rows = await prisma.aiUsage.groupBy({ by: ["status"], where: { status: { in: ["RESERVED", "CALLING"] } }, _count: true });
      g.reset();
      for (const status of ["RESERVED", "CALLING"]) g.set({ status }, rows.find((r) => r.status === status)?._count ?? 0);
    });
    gauge("plandit_queue_jobs", "BullMQ jobs by queue and state", ["queue", "state"], async (g) => {
      g.reset();
      for (const queue of this.queues) {
        const counts = await queue.getJobCounts("waiting", "delayed", "active", "failed");
        for (const [state, count] of Object.entries(counts)) g.set({ queue: queue.name, state }, count);
      }
    });
  }

  async onModuleDestroy() {
    await Promise.all(this.queues.map((queue) => queue.close()));
  }
}

/** Prometheus scrape endpoint. Not for the public internet: METRICS_TOKEN (bearer) when set, and blocked at the proxy. */
@ApiExcludeController()
@Public()
@Controller("metrics")
export class MetricsController {
  @Get()
  async scrape(
    @Headers("authorization") authorization: string | undefined,
    @Res() res: { setHeader(name: string, value: string): void; send(body: string): void },
  ) {
    const token = process.env.METRICS_TOKEN;
    if (token && !safeEqual(authorization ?? "", `Bearer ${token}`)) {
      throw new ApiError(ErrorCode.UNAUTHORIZED, "Invalid metrics token.");
    }
    res.setHeader("content-type", register.contentType);
    res.send(await register.metrics());
  }
}

@Module({ controllers: [MetricsController], providers: [MetricsService] })
export class MetricsModule {}
