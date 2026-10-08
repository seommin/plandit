import { MockLlmAdapter } from "../ai/mock-llm.adapter";
import { toLocalIso } from "../common/zoned-time";
import { buildAssistantRequest, mockAssistantReply, userTurn } from "./assistant-prompt";
import { ASSISTANT_TOOLS, LLM_TOOLS, toolNamed } from "./assistant-tools";
import { type FreeRangeQuery, freeRanges, nextHalfHour } from "./free-slots";

const kst = (local: string) => new Date(`${local}+09:00`);
const local = (ranges: Array<{ start: Date; end: Date }>, tz = "Asia/Seoul") =>
  ranges.map((r) => `${toLocalIso(r.start, tz).slice(0, 16)}~${toLocalIso(r.end, tz).slice(11, 16)}`);

const query = (over: Partial<FreeRangeQuery> = {}): FreeRangeQuery => ({
  fromDate: "2026-10-08", // Thursday
  toDate: "2026-10-08",
  dayStart: "09:00",
  dayEnd: "18:00",
  timezone: "Asia/Seoul",
  includeWeekends: false,
  minMinutes: 60,
  busy: [],
  notBefore: kst("2026-10-01T00:00:00"),
  ...over,
});

describe("freeRanges", () => {
  it("returns the gaps between busy times inside the day's window, merging overlaps", () => {
    const busy = [
      { start: kst("2026-10-08T10:00:00"), end: kst("2026-10-08T11:00:00") },
      { start: kst("2026-10-08T10:30:00"), end: kst("2026-10-08T12:00:00") }, // overlaps the first
      { start: kst("2026-10-08T13:00:00"), end: kst("2026-10-08T13:30:00") },
      { start: kst("2026-10-08T17:00:00"), end: kst("2026-10-08T19:00:00") }, // runs past the window
      { start: kst("2026-10-08T07:00:00"), end: kst("2026-10-08T08:00:00") }, // before the window
    ];
    expect(local(freeRanges(query({ busy, minMinutes: 30 })))).toEqual([
      "2026-10-08T09:00~10:00",
      "2026-10-08T12:00~13:00",
      "2026-10-08T13:30~17:00",
    ]);
  });

  it("treats touching events as back to back and drops gaps shorter than the duration", () => {
    const busy = [
      { start: kst("2026-10-08T09:00:00"), end: kst("2026-10-08T10:00:00") },
      { start: kst("2026-10-08T10:00:00"), end: kst("2026-10-08T10:30:00") },
      { start: kst("2026-10-08T11:00:00"), end: kst("2026-10-08T18:00:00") },
    ];
    expect(freeRanges(query({ busy, minMinutes: 60 }))).toEqual([]);
    expect(local(freeRanges(query({ busy, minMinutes: 30 })))).toEqual(["2026-10-08T10:30~11:00"]);
  });

  it("skips weekends unless asked, and nothing starts before notBefore", () => {
    const weekend = query({ fromDate: "2026-10-09", toDate: "2026-10-12" }); // Fri..Mon
    expect(local(freeRanges(weekend)).map((r) => r.slice(0, 10))).toEqual(["2026-10-09", "2026-10-12"]);
    expect(freeRanges({ ...weekend, includeWeekends: true })).toHaveLength(4);
    expect(local(freeRanges(query({ notBefore: nextHalfHour(kst("2026-10-08T14:07:00")) })))).toEqual(["2026-10-08T14:30~18:00"]);
  });

  it("uses the person's wall clock across a DST change", () => {
    const paris = query({ fromDate: "2026-10-23", toDate: "2026-10-26", timezone: "Europe/Paris", includeWeekends: true }); // DST ends 25 Oct
    const ranges = freeRanges(paris);
    expect(local(ranges, "Europe/Paris")).toEqual([
      "2026-10-23T09:00~18:00",
      "2026-10-24T09:00~18:00",
      "2026-10-25T09:00~18:00",
      "2026-10-26T09:00~18:00",
    ]);
    expect(toLocalIso(ranges[1].start, "Europe/Paris")).toBe("2026-10-24T09:00:00+02:00");
    expect(toLocalIso(ranges[2].start, "Europe/Paris")).toBe("2026-10-25T09:00:00+01:00");
  });
});

describe("assistant tools", () => {
  const parse = (name: string, input: unknown) => toolNamed(name)!.input.safeParse(input);

  it("exposes a fixed list with closed schemas, and only create_event changes anything", () => {
    expect(LLM_TOOLS.map((t) => t.name)).toEqual(["list_calendars", "list_members", "list_events", "find_free_slots", "search_memory", "create_event"]);
    expect(ASSISTANT_TOOLS.filter((t) => t.write).map((t) => t.name)).toEqual(["create_event"]);
    for (const tool of LLM_TOOLS) expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    // Defaults stay optional for the model
    expect(LLM_TOOLS.find((t) => t.name === "find_free_slots")!.inputSchema.required).toEqual(["fromDate", "toDate", "durationMinutes"]);
  });

  it("validates inputs before anything runs", () => {
    const event = { calendarId: "c1", title: "회의", startsAt: "2026-10-08T10:00:00+09:00", endsAt: "2026-10-08T11:00:00+09:00" };
    expect(parse("create_event", event).success).toBe(true);
    expect(parse("create_event", { ...event, endsAt: event.startsAt }).success).toBe(false);
    expect(parse("create_event", { ...event, endsAt: "2026-10-09T11:00:01+09:00" }).success).toBe(false); // over 24 hours
    expect(parse("create_event", { ...event, startsAt: "2026-10-08T10:00:00" }).success).toBe(false); // no offset
    expect(parse("create_event", { ...event, attendeeUserIds: ["u1", "u1"] }).success).toBe(false);

    const slots = { fromDate: "2026-10-08", toDate: "2026-10-10", durationMinutes: 60 };
    expect(parse("find_free_slots", slots).data).toMatchObject({ dayStart: "09:00", dayEnd: "18:00", includeWeekends: false });
    expect(parse("find_free_slots", { ...slots, toDate: "2026-10-22" }).success).toBe(false); // 15 days
    expect(parse("find_free_slots", { ...slots, dayStart: "18:00", dayEnd: "09:00" }).success).toBe(false);
    expect(parse("find_free_slots", { ...slots, durationMinutes: 5 }).success).toBe(false);
    expect(parse("list_events", { from: "2026-10-01T00:00:00Z", to: "2026-11-02T00:00:00Z" }).success).toBe(false); // 32 days
  });
});

describe("assistant prompt", () => {
  it("keeps the prefix fixed and puts the time in the person's message", () => {
    const now = kst("2026-10-07T14:03:00");
    expect(userTurn("내일 회의", now, "Asia/Seoul")).toBe("[지금] 2026-10-07T14:03:00+09:00 (수), 시간대 Asia/Seoul\n\n내일 회의");
    const a = buildAssistantRequest([{ role: "user", content: "a" }]);
    const b = buildAssistantRequest([{ role: "user", content: "b" }]);
    expect(a.system).toBe(b.system);
    expect(JSON.stringify(a.tools)).toBe(JSON.stringify(b.tools));
    expect(a.system).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("mock walks calendars → free time → a proposal that waits → a report", async () => {
    const llm = new MockLlmAdapter();
    const messages = buildAssistantRequest([{ role: "user", content: userTurn("회의 잡아줘", kst("2026-10-07T14:03:00"), "Asia/Seoul") }]).messages;
    const step = async (toolOutput?: unknown) => {
      const reply = mockAssistantReply(buildAssistantRequest(messages));
      llm.enqueue(reply);
      const result = await llm.complete(buildAssistantRequest(messages));
      messages.push({ role: "assistant", content: result.text, replay: result.replay });
      if (toolOutput !== undefined) {
        messages.push({ role: "user", content: "", toolResults: [{ toolCallId: result.toolCalls[0].id, content: JSON.stringify(toolOutput) }] });
      }
      return result;
    };

    expect((await step({ calendars: [{ id: "view", writable: false }, { id: "team", writable: true }] })).toolCalls[0].name).toBe("list_calendars");
    const slots = await step({ freeRanges: [{ start: "2026-10-08T09:00:00+09:00", end: "2026-10-08T18:00:00+09:00" }] });
    expect(slots.toolCalls[0]).toMatchObject({ name: "find_free_slots", input: { fromDate: "2026-10-07", toDate: "2026-10-13", durationMinutes: 60 } });
    const proposal = await step({ eventId: "e1", title: "회의", start: "2026-10-08T09:00:00+09:00" });
    expect(proposal.text).toContain("10월 8일 09:00");
    expect(proposal.toolCalls[0]).toMatchObject({ name: "create_event", input: { calendarId: "team", startsAt: "2026-10-08T09:00:00+09:00", endsAt: "2026-10-08T01:00:00.000Z" } });
    expect(toolNamed("create_event")!.input.safeParse(proposal.toolCalls[0].input).success).toBe(true);
    const report = await step();
    expect(report).toMatchObject({ stopReason: "end", toolCalls: [] });
    expect(report.text).toContain("일정을 넣었어요");
  });

  it("mock reads 내일 and 오후 when it looks for free time", () => {
    const messages = buildAssistantRequest([{ role: "user", content: userTurn("내일 오후에 1시간 회의 잡아줘", kst("2026-10-07T14:03:00"), "Asia/Seoul") }]).messages;
    messages.push({ role: "assistant", content: "" }, { role: "user", content: "", toolResults: [{ toolCallId: "t1", content: JSON.stringify({ calendars: [] }) }] });
    const reply = mockAssistantReply(buildAssistantRequest(messages));
    expect(reply.text).toBe("내일 오후 중 1시간 비는 때를 찾아볼게요.");
    expect(reply.toolCalls![0]).toMatchObject({ name: "find_free_slots", input: { fromDate: "2026-10-08", toDate: "2026-10-08", dayStart: "13:00" } });
    expect(toolNamed("find_free_slots")!.input.safeParse(reply.toolCalls![0].input).success).toBe(true);
  });
});
