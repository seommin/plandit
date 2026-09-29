import { Injectable } from "@nestjs/common";
import type { z } from "zod";

import { type DeliveryStatus, prisma } from "@plandit/database/prisma";
import type { reminderSetSchema } from "@plandit/shared/reminders";

import { type PageQuery, pageArgs, toPage } from "../common/pagination";
import { fireAtFor } from "./reminder-time";
import { ReminderQueue } from "./reminder.queue";

type ReminderInput = z.infer<typeof reminderSetSchema>["reminders"][number];

/** API side: keeps the delayed "fire" jobs in line with the event's current time and reminder list. */
@Injectable()
export class ReminderService {
  constructor(private readonly queue: ReminderQueue) {}

  list(eventId: string) {
    return prisma.eventReminder.findMany({ where: { eventId }, orderBy: [{ minutesBefore: "desc" }, { channel: "asc" }] });
  }

  /** Replaces the event's reminders. Unchanged (minutesBefore, channel) pairs keep their id and pending job. */
  async setReminders(eventId: string, userId: string, wanted: ReminderInput[]) {
    const key = (r: { minutesBefore: number; channel: string }) => `${r.minutesBefore}:${r.channel}`;
    const existing = await prisma.eventReminder.findMany({ where: { eventId } });
    const wantedByKey = new Map(wanted.map((r) => [key(r), r]));
    const existingKeys = new Set(existing.map(key));

    await prisma.$transaction([
      prisma.eventReminder.deleteMany({
        where: { id: { in: existing.filter((r) => !wantedByKey.has(key(r))).map((r) => r.id) } },
      }),
      ...existing
        .filter((r) => wantedByKey.has(key(r)) && wantedByKey.get(key(r))!.audience !== r.audience)
        .map((r) => prisma.eventReminder.update({ where: { id: r.id }, data: { audience: wantedByKey.get(key(r))!.audience } })),
      prisma.eventReminder.createMany({
        data: wanted.filter((r) => !existingKeys.has(key(r))).map((r) => ({ ...r, eventId, createdById: userId })),
      }),
    ]);

    await this.syncEvent(eventId);
    return this.list(eventId);
  }

  async listDeliveries(workspaceId: string, page: PageQuery, status?: DeliveryStatus) {
    const { orderBy, ...args } = pageArgs(page);
    const rows = await prisma.reminderDelivery.findMany({
      where: { workspaceId, ...(status ? { status } : {}) },
      ...args,
      orderBy: [{ queuedAt: page.order }, { id: page.order }],
      select: {
        id: true,
        channel: true,
        status: true,
        credits: true,
        failCode: true,
        fallback: true,
        fireAt: true,
        queuedAt: true,
        sentAt: true,
        resultAt: true,
        refundLedgerId: true,
        user: { select: { id: true, name: true } },
        reminder: { select: { event: { select: { id: true, title: true } } } },
      },
    });
    const { items, nextCursor } = toPage(rows, page.limit, (row) => row.id);
    return { items: items.map(({ refundLedgerId, ...row }) => ({ ...row, refunded: refundLedgerId !== null })), nextCursor };
  }

  /**
   * (Re)schedules every reminder of the event at its current fire time. Safe to call after any event change:
   * an unchanged time maps to an existing job id (no-op); a changed time adds a new job and orphans the old one.
   */
  async syncEvent(eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { reminders: true, calendar: { select: { timezone: true } } },
    });
    if (!event || event.status === "CANCELLED") return;
    await Promise.all(
      event.reminders.map((r) => this.queue.scheduleFire(r.id, fireAtFor(event, r.minutesBefore, event.calendar.timezone))),
    );
  }
}
