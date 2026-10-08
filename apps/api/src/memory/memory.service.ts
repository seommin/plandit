import { createHash } from "crypto";

import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";

import { type Document, Prisma, prisma } from "@plandit/database/prisma";

import { EMBEDDING_CLIENT, type EmbeddingClient, toVector } from "../ai/embedding";
import { getWritableEvent } from "../events/event-permissions";
import { chunkText, documentText, type UploadedFile } from "./document-text";
import { MemoryQueue } from "./memory.queue";

export type MemoryScope = {
  userId: string;
  /** Only this workspace's calendars (an API key over MCP). Without it, everything the person can see. */
  workspaceId?: string;
  from?: Date;
  to?: Date;
};

export type MemoryHit = {
  kind: "document" | "event";
  eventId: string;
  eventTitle: string;
  eventStart: Date;
  filename: string | null;
  excerpt: string;
  score: number;
};

const SYNC_BATCH = 64;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const eventText = (e: { title: string; location: string | null; description: string | null }) =>
  [e.title, e.location, e.description].filter(Boolean).join("\n");

export const toDocumentDto = (d: Document & { _count?: { chunks: number }; uploadedBy?: { id: string; name: string | null } }) => ({
  id: d.id,
  eventId: d.eventId,
  filename: d.filename,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  charCount: d.charCount,
  status: d.status,
  chunkCount: d._count?.chunks ?? null,
  uploadedBy: d.uploadedBy ?? null,
  createdAt: d.createdAt,
  readyAt: d.readyAt,
});

/**
 * Meeting notes and events as searchable memory (PLANDIT-22). Uploads keep only the text, cut into chunks; the worker
 * embeds chunks and events in the background. Search sees exactly what the person could see in the event list.
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    @Inject(EMBEDDING_CLIENT) private readonly embedder: EmbeddingClient,
    private readonly queue: MemoryQueue,
  ) {}

  /** Who may change the event may attach notes to it. The text is read now; the file is not kept. */
  async upload(userId: string, eventId: string, file: UploadedFile) {
    if (!(await getWritableEvent(eventId, userId))) throw new NotFoundException("Event not found.");
    const { text, mimeType } = await documentText(file);
    const chunks = chunkText(text);
    const document = await prisma.document.create({
      data: {
        eventId,
        uploadedById: userId,
        filename: file.originalname.slice(0, 200),
        mimeType,
        sizeBytes: file.size,
        charCount: text.length,
        chunks: { create: chunks.map((content, seq) => ({ seq, content })) },
      },
      include: { _count: { select: { chunks: true } }, uploadedBy: { select: { id: true, name: true } } },
    });
    await this.queue.enqueueSync(`document_${document.id}`);
    return toDocumentDto(document);
  }

  /** Notes of an event the person can see (same rule as the event list), newest first. */
  async list(userId: string, eventId: string) {
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        OR: [
          { visibility: "PRIVATE", createdById: userId },
          { visibility: { in: ["CALENDAR", "PUBLIC_LINK"] }, calendar: { members: { some: { userId } } } },
        ],
      },
      select: { id: true },
    });
    if (!event) throw new NotFoundException("Event not found.");
    const documents = await prisma.document.findMany({
      where: { eventId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } }, uploadedBy: { select: { id: true, name: true } } },
    });
    return { items: documents.map(toDocumentDto) };
  }

  async remove(userId: string, eventId: string, documentId: string) {
    if (!(await getWritableEvent(eventId, userId))) throw new NotFoundException("Event not found.");
    const { count } = await prisma.document.deleteMany({ where: { id: documentId, eventId } });
    if (!count) throw new NotFoundException("Document not found.");
    return { ok: true };
  }

  /**
   * The closest note chunks and events to `query`, among what the person can see — merged and ranked by cosine
   * similarity. Only vectors of the current embedder count (others are being redone by the worker).
   */
  async search(scope: MemoryScope, query: string, limit = 6): Promise<MemoryHit[]> {
    const [vector] = await this.embedder.embed([query], "query");
    const target = Prisma.sql`${toVector(vector)}::vector`;
    const where = Prisma.sql`
      ((e."visibility" = 'PRIVATE' AND e."createdById" = ${scope.userId})
        OR (e."visibility" IN ('CALENDAR', 'PUBLIC_LINK')
          AND EXISTS (SELECT 1 FROM "CalendarMember" m WHERE m."calendarId" = e."calendarId" AND m."userId" = ${scope.userId})))
      ${scope.workspaceId ? Prisma.sql`AND cal."workspaceId" = ${scope.workspaceId}` : Prisma.empty}
      ${scope.from ? Prisma.sql`AND e."startsAt" >= ${scope.from}` : Prisma.empty}
      ${scope.to ? Prisma.sql`AND e."startsAt" < ${scope.to}` : Prisma.empty}`;

    const rows = await prisma.$transaction(async (tx) => {
      // The HNSW index returns nearest rows first and the filters above drop some; keep scanning instead of coming up short.
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = relaxed_order`;
      const chunks = await tx.$queryRaw<MemoryHit[]>`
        SELECT 'document' AS "kind", e."id" AS "eventId", e."title" AS "eventTitle", e."startsAt" AS "eventStart",
               d."filename", c."content" AS "excerpt", 1 - (c."embedding" <=> ${target}) AS "score"
        FROM "DocumentChunk" c
        JOIN "Document" d ON d."id" = c."documentId"
        JOIN "Event" e ON e."id" = d."eventId"
        JOIN "Calendar" cal ON cal."id" = e."calendarId"
        WHERE c."model" = ${this.embedder.model} AND c."embedding" IS NOT NULL AND ${where}
        ORDER BY c."embedding" <=> ${target}
        LIMIT ${limit}`;
      const events = await tx.$queryRaw<MemoryHit[]>`
        SELECT 'event' AS "kind", e."id" AS "eventId", e."title" AS "eventTitle", e."startsAt" AS "eventStart",
               NULL AS "filename", concat_ws(' · ', e."title", e."location", e."description") AS "excerpt",
               1 - (x."embedding" <=> ${target}) AS "score"
        FROM "EventEmbedding" x
        JOIN "Event" e ON e."id" = x."eventId"
        JOIN "Calendar" cal ON cal."id" = e."calendarId"
        WHERE x."model" = ${this.embedder.model} AND ${where}
        ORDER BY x."embedding" <=> ${target}
        LIMIT ${limit}`;
      return [...chunks, ...events];
    });
    return rows
      .map((row) => ({ ...row, score: Number(row.score) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Worker: embeds one batch of what is missing or was made by another model — note chunks, then events whose text
   * changed (a moved event keeps its vector). Documents whose chunks are all done become READY.
   */
  async syncBatch() {
    const model = this.embedder.model;
    const chunks = await prisma.$queryRaw<Array<{ id: string; content: string }>>`
      SELECT "id", "content" FROM "DocumentChunk" WHERE "model" IS DISTINCT FROM ${model} ORDER BY "documentId", "seq" LIMIT ${SYNC_BATCH}`;
    if (chunks.length) {
      const vectors = await this.embedder.embed(chunks.map((c) => c.content), "passage");
      await prisma.$transaction(
        chunks.map((c, i) => prisma.$executeRaw`UPDATE "DocumentChunk" SET "embedding" = ${toVector(vectors[i])}::vector, "model" = ${model} WHERE "id" = ${c.id}`),
      );
    }
    await prisma.$executeRaw`
      UPDATE "Document" d SET "status" = 'READY', "readyAt" = now()
      WHERE d."status" = 'PROCESSING'
        AND NOT EXISTS (SELECT 1 FROM "DocumentChunk" c WHERE c."documentId" = d."id" AND c."model" IS DISTINCT FROM ${model})`;

    const events = await prisma.$queryRaw<Array<{ id: string; title: string; location: string | null; description: string | null; hash: string | null; model: string | null }>>`
      SELECT e."id", e."title", e."location", e."description", x."contentHash" AS "hash", x."model"
      FROM "Event" e LEFT JOIN "EventEmbedding" x ON x."eventId" = e."id"
      WHERE x."eventId" IS NULL OR x."model" <> ${model} OR x."updatedAt" < e."updatedAt"
      ORDER BY e."updatedAt" LIMIT ${SYNC_BATCH}`;
    const stale = events.map((e) => ({ ...e, text: eventText(e) })).map((e) => ({ ...e, newHash: sha256(e.text) }));
    const unchanged = stale.filter((e) => e.hash === e.newHash && e.model === model);
    const changed = stale.filter((e) => !unchanged.includes(e));
    if (unchanged.length) {
      // Only the time or calendar moved: nothing to embed, just stop looking at it.
      await prisma.eventEmbedding.updateMany({ where: { eventId: { in: unchanged.map((e) => e.id) } }, data: { updatedAt: new Date() } });
    }
    if (changed.length) {
      const vectors = await this.embedder.embed(changed.map((e) => e.text), "passage");
      await prisma.$transaction(
        changed.map(
          (e, i) => prisma.$executeRaw`
            INSERT INTO "EventEmbedding" ("eventId", "contentHash", "model", "embedding", "updatedAt")
            VALUES (${e.id}, ${e.newHash}, ${model}, ${toVector(vectors[i])}::vector, now())
            ON CONFLICT ("eventId") DO UPDATE SET "contentHash" = EXCLUDED."contentHash", "model" = EXCLUDED."model",
              "embedding" = EXCLUDED."embedding", "updatedAt" = now()`,
        ),
      );
    }
    return { chunks: chunks.length, events: changed.length + unchanged.length };
  }

  /** Worker: batches until nothing is left (bounded, so one job never runs forever). */
  async sync(maxBatches = 50) {
    const total = { chunks: 0, events: 0 };
    for (let i = 0; i < maxBatches; i++) {
      const done = await this.syncBatch();
      total.chunks += done.chunks;
      total.events += done.events;
      if (!done.chunks && !done.events) break;
    }
    if (total.chunks || total.events) this.logger.log(total, "Embeddings synced");
    return total;
  }
}
