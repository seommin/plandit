import type { INestApplication } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";

import { EMBEDDING_CLIENT, type EmbeddingClient } from "../src/ai/embedding";
import { LLM_CLIENT } from "../src/ai/llm-client";
import type { MockLlmAdapter } from "../src/ai/mock-llm.adapter";
import { AssistantService } from "../src/assistant/assistant.service";
import { LedgerService } from "../src/credit/ledger.service";
import { MemoryService } from "../src/memory/memory.service";
import { as, closeTestApp, createTestApp, registerUser, resetDatabase } from "./helpers";

type User = { id: string; email: string };

const NOTE = [
  "A사 미팅 회의록",
  "참석: 김데모, 이팀원, A사 박부장",
  "결정 사항: A사와 10월 출시 일정을 확정했다. 가격은 다음 주 화요일에 다시 논의한다.",
  "할 일: 이팀원이 계약서 초안을 금요일까지 보낸다.",
].join("\n");

describe("PLANDIT-22 meeting notes search (e2e)", () => {
  let app: INestApplication;
  let memory: MemoryService;
  let embedder: EmbeddingClient;
  let llm: MockLlmAdapter;
  let owner: User, editor: User, viewer: User, outsider: User;
  let workspaceId: string;
  let teamCalendarId: string;
  let meetingId: string;
  let privateId: string;

  const docs = (eventId: string) => `/events/${eventId}/documents`;
  const upload = (user: User, eventId: string, content: Buffer | string, filename = "A사 미팅 회의록.txt") =>
    as(app, user.id).post(docs(eventId)).attach("file", Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"), filename);
  const event = async (user: User, body: Record<string, unknown>) => (await as(app, user.id).post("/events").send(body).expect(201)).body.event.id as string;
  const titles = async (scope: Parameters<MemoryService["search"]>[0], query: string) =>
    (await memory.search(scope, query)).map((h) => `${h.kind}:${h.eventTitle}${h.filename ? `/${h.filename}` : ""}`);

  beforeAll(async () => {
    app = await createTestApp();
    memory = app.get(MemoryService);
    embedder = app.get(EMBEDDING_CLIENT);
    llm = app.get(LLM_CLIENT);
    await resetDatabase();
    [owner, editor, viewer, outsider] = await Promise.all(["owner", "editor", "viewer", "outsider"].map((n) => registerUser(app, n)));
    workspaceId = (await as(app, owner.id).post("/workspaces").send({ name: "회의팀" }).expect(201)).body.workspace.id;
    for (const user of [editor, viewer]) await as(app, owner.id).post(`/workspaces/${workspaceId}/members`).send({ email: user.email }).expect(201);
    teamCalendarId = (await as(app, owner.id).post("/calendars").send({ name: "팀 캘린더", type: "SHARED", workspaceId }).expect(201)).body.calendar.id;
    await as(app, owner.id).post(`/calendars/${teamCalendarId}/invites`).send({ email: editor.email, role: "EDITOR" }).expect(201);
    await as(app, owner.id).post(`/calendars/${teamCalendarId}/invites`).send({ email: viewer.email, role: "VIEWER" }).expect(201);

    meetingId = await event(owner, { calendarId: teamCalendarId, title: "A사 미팅", location: "A사 본사", startsAt: "2026-09-10T01:00:00.000Z", endsAt: "2026-09-10T02:00:00.000Z" });
    await event(owner, { calendarId: teamCalendarId, title: "B사 점심", startsAt: "2026-09-11T03:00:00.000Z", endsAt: "2026-09-11T04:00:00.000Z" });
    // In the owner's personal workspace, PRIVATE: only the owner may ever find it
    privateId = await event(owner, { title: "개인 상담", startsAt: "2026-09-12T01:00:00.000Z", endsAt: "2026-09-12T02:00:00.000Z" });

    const accountId = (await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId } })).id;
    await app.get(LedgerService).append({ accountId, type: "CHARGE", amount: 1_000, refType: "PAYMENT", refId: "seed", idempotencyKey: "PAYMENT:seed:CHARGE" });
  });

  beforeEach(() => llm.reset());

  afterAll(() => closeTestApp(app));

  it("takes a note from whoever can change the event, keeps only its text, and makes it searchable in the background", async () => {
    const res = await upload(editor, meetingId, NOTE).expect(201);
    expect(res.body).toMatchObject({ eventId: meetingId, filename: "A사 미팅 회의록.txt", mimeType: "text/plain", status: "PROCESSING", charCount: NOTE.length, chunkCount: 1 });
    expect(await prisma.documentChunk.findMany({ where: { documentId: res.body.id }, select: { content: true, model: true } })).toEqual([{ content: NOTE, model: null }]);

    expect(await memory.sync()).toMatchObject({ chunks: 1 });
    const listed = (await as(app, viewer.id).get(docs(meetingId)).expect(200)).body.items;
    expect(listed).toMatchObject([{ id: res.body.id, status: "READY", uploadedBy: { id: editor.id } }]);
    expect(await prisma.documentChunk.count({ where: { model: embedder.model } })).toBe(1);
    expect(await prisma.eventEmbedding.count()).toBe(3); // every event, including ones without notes
  });

  it("finds the note for whoever can see the event, and nothing for anyone else", async () => {
    await upload(owner, privateId, "개인 상담 메모: 이직 고민, 연봉 협상", "상담.txt").expect(201);
    await memory.sync();

    const question = "A사 출시 일정 결정";
    const [top] = await memory.search({ userId: owner.id }, question);
    expect(top).toMatchObject({ kind: "document", eventId: meetingId, eventTitle: "A사 미팅", filename: "A사 미팅 회의록.txt" });
    expect(top.excerpt).toContain("10월 출시");
    expect((await titles({ userId: viewer.id }, question))[0]).toBe("document:A사 미팅/A사 미팅 회의록.txt");
    expect(await titles({ userId: outsider.id }, question)).toEqual([]);

    expect(await titles({ userId: owner.id }, "연봉 협상")).toContain("document:개인 상담/상담.txt");
    expect(await titles({ userId: viewer.id }, "연봉 협상")).not.toContain("document:개인 상담/상담.txt");
    // An API key's workspace scope (MCP): the personal workspace is out of reach
    expect(await titles({ userId: owner.id, workspaceId }, "연봉 협상")).not.toContain("document:개인 상담/상담.txt");
    // A date range
    expect(await titles({ userId: owner.id, from: new Date("2026-09-11T00:00:00Z") }, question)).not.toContain("document:A사 미팅/A사 미팅 회의록.txt");
  });

  it("re-embeds an event only when its text changes, and every vector when the embedder changes", async () => {
    const before = await prisma.eventEmbedding.findUniqueOrThrow({ where: { eventId: meetingId } });
    const spy = jest.spyOn(embedder, "embed");
    try {
      await as(app, owner.id).patch(`/events/${meetingId}`).send({ startsAt: "2026-09-10T02:00:00.000Z", endsAt: "2026-09-10T03:00:00.000Z" }).expect(200);
      await memory.sync();
      expect(spy).not.toHaveBeenCalled(); // moved, not reworded
      expect((await prisma.eventEmbedding.findUniqueOrThrow({ where: { eventId: meetingId } })).contentHash).toBe(before.contentHash);

      await as(app, owner.id).patch(`/events/${meetingId}`).send({ title: "A사 계약 미팅" }).expect(200);
      await memory.sync();
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await prisma.eventEmbedding.findUniqueOrThrow({ where: { eventId: meetingId } })).contentHash).not.toBe(before.contentHash);
      expect(await titles({ userId: viewer.id }, "A사 계약 미팅")).toContain("event:A사 계약 미팅");

      spy.mockClear();
      await prisma.documentChunk.updateMany({ data: { model: "an-old-model" } });
      await prisma.eventEmbedding.updateMany({ data: { model: "an-old-model" } });
      expect(await titles({ userId: owner.id }, "A사")).toEqual([]); // old vectors are not compared with new ones
      expect(await memory.sync()).toEqual({ chunks: 2, events: 3 });
      expect(await prisma.documentChunk.count({ where: { model: { not: embedder.model } } })).toBe(0);
      expect((await titles({ userId: owner.id }, "A사 출시 일정"))[0]).toBe("document:A사 계약 미팅/A사 미팅 회의록.txt");
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses unreadable files and the wrong people, storing nothing", async () => {
    const count = () => prisma.document.count();
    const before = await count();
    expect((await upload(owner, meetingId, "   ", "빈 파일.txt").expect(400)).body).toMatchObject({ code: "DOCUMENT_UNREADABLE", details: { reason: "NO_TEXT" } });
    expect((await upload(owner, meetingId, "PK\u0003\u0004", "notes.docx").expect(400)).body).toMatchObject({ details: { reason: "TYPE" } });
    expect((await upload(owner, meetingId, "%PDF-1.4 broken", "scan.pdf").expect(400)).body).toMatchObject({ details: { reason: "CORRUPT" } });
    await upload(owner, meetingId, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61), "huge.txt").expect(413);
    await as(app, owner.id).post(docs(meetingId)).expect(400); // no file
    await upload(viewer, meetingId, NOTE).expect(403);
    await upload(outsider, meetingId, NOTE).expect(404);
    await upload(viewer, privateId, NOTE).expect(404); // someone else's private event does not exist for them
    await as(app, outsider.id).get(docs(meetingId)).expect(404);
    expect(await count()).toBe(before);
  });

  it("lets the assistant answer from the notes, citing where it found it", async () => {
    const thread = (await as(app, viewer.id).post(`/workspaces/${workspaceId}/assistant/threads`).expect(201)).body.id;
    await as(app, viewer.id).post(`/workspaces/${workspaceId}/assistant/threads/${thread}/messages`).send({ text: "A사 미팅에서 뭐 정했지?" }).expect(202);
    expect(await app.get(AssistantService).run(thread)).toBe("ANSWERED");

    const view = (await as(app, viewer.id).get(`/workspaces/${workspaceId}/assistant/threads/${thread}`).expect(200)).body;
    const step = view.items.find((i: { name?: string }) => i.name === "search_memory");
    expect(step).toMatchObject({ status: "DONE", sources: expect.arrayContaining([{ event: "A사 계약 미팅", date: "2026-09-10", file: "A사 미팅 회의록.txt" }]) });
    const answer = view.items[view.items.length - 1];
    expect(answer.type).toBe("assistant");
    expect(answer.text).toContain("A사 계약 미팅(9월 10일) 회의록 「A사 미팅 회의록.txt」에서 찾았어요");
    expect(answer.text).toContain("10월 출시");
  });

  it("forgets a deleted note", async () => {
    const [document] = (await as(app, editor.id).get(docs(meetingId)).expect(200)).body.items;
    await as(app, viewer.id).delete(`${docs(meetingId)}/${document.id}`).expect(403);
    await as(app, editor.id).delete(`${docs(meetingId)}/${document.id}`).expect(200);
    await as(app, editor.id).delete(`${docs(meetingId)}/${document.id}`).expect(404);
    expect(await prisma.documentChunk.count({ where: { documentId: document.id } })).toBe(0);
    expect(await titles({ userId: owner.id }, "A사 출시 일정 결정")).not.toContain("document:A사 계약 미팅/A사 미팅 회의록.txt");
  });
});
