import { tripDayCount, tripDates, type TripDraft, tripInputSchema } from "@plandit/shared/trips";

import { ceilingRates, estimateInputTokens, reserveCredits } from "@plandit/shared/ai";

import { requestText } from "../ai/llm-client";
import { draftProblems, draftToEvents, localToInstant, parseDraft } from "./trip-draft";
import { buildTripRequest, largestTripInput, mockTripReply, tripMaxOutputTokens } from "./trip-prompt";

const input = tripInputSchema.parse({ calendarId: "c", destination: "부산", startDate: "2026-10-09", endDate: "2026-10-11" });
const item = (startTime: string, endTime: string, title = "구경") => ({ title, startTime, endTime, location: null, description: null, category: "SIGHT" as const });
const draft = (days: TripDraft["days"], timezone = "Asia/Seoul"): TripDraft => ({ timezone, days, notes: null });

describe("trip dates", () => {
  it("counts both ends and lists every day", () => {
    expect(tripDayCount("2026-10-09", "2026-10-11")).toBe(3);
    expect(tripDayCount("2026-10-09", "2026-10-09")).toBe(1);
    expect(tripDates("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

describe("draftProblems", () => {
  it("accepts a draft inside the trip", () => {
    expect(draftProblems(draft([{ date: "2026-10-10", items: [item("09:00", "10:00")] }]), input)).toEqual([]);
  });

  it("flags dates outside the trip or repeated, items that end before they start, and unknown time zones", () => {
    const problems = draftProblems(
      draft(
        [
          { date: "2026-10-08", items: [item("09:00", "10:00")] },
          { date: "2026-10-10", items: [item("11:00", "10:00"), item("12:00", "12:00")] },
          { date: "2026-10-10", items: [item("09:00", "10:00")] },
        ],
        "Mars/Olympus",
      ),
      input,
    );
    expect(problems.map((p) => p.path)).toEqual(["timezone", "days.0.date", "days.1.items.0.endTime", "days.1.items.1.endTime", "days.2.date"]);
  });
});

describe("parseDraft", () => {
  it("validates the model's JSON and sorts days and items", () => {
    const text = JSON.stringify(
      draft([
        { date: "2026-10-11", items: [item("15:00", "16:00", "나중"), item("09:00", "10:00", "먼저")] },
        { date: "2026-10-09", items: [item("10:00", "11:00")] },
      ]),
    );
    const parsed = parseDraft(text, input);
    expect(parsed.days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-11"]);
    expect(parsed.days[1].items.map((i) => i.title)).toEqual(["먼저", "나중"]);
  });

  it.each([
    ["not JSON", "여행 일정이에요"],
    ["too many items in a day", JSON.stringify(draft([{ date: "2026-10-09", items: Array.from({ length: 11 }, () => item("09:00", "10:00")) }]))],
    ["a clock that is not HH:mm", JSON.stringify(draft([{ date: "2026-10-09", items: [item("9:00", "10:00")] }]))],
    ["a date outside the trip", JSON.stringify(draft([{ date: "2026-10-20", items: [item("09:00", "10:00")] }]))],
  ])("throws for %s", (_label, text) => {
    expect(() => parseDraft(text, input)).toThrow();
  });
});

describe("local time → instant", () => {
  it("uses the offset of that day, across the Europe/Paris DST start (2026-03-29 02:00 → 03:00)", () => {
    expect(localToInstant("2026-03-28", "10:00", "Europe/Paris").toISOString()).toBe("2026-03-28T09:00:00.000Z"); // CET +1
    expect(localToInstant("2026-03-29", "01:30", "Europe/Paris").toISOString()).toBe("2026-03-29T00:30:00.000Z"); // still CET
    expect(localToInstant("2026-03-29", "03:30", "Europe/Paris").toISOString()).toBe("2026-03-29T01:30:00.000Z"); // CEST +2
    expect(localToInstant("2026-03-29", "02:30", "Europe/Paris").toISOString()).toBe("2026-03-29T01:30:00.000Z"); // skipped → 03:30
    expect(localToInstant("2026-10-26", "10:00", "Europe/Paris").toISOString()).toBe("2026-10-26T09:00:00.000Z"); // back to CET
    expect(localToInstant("2026-10-09", "09:00", "Asia/Seoul").toISOString()).toBe("2026-10-09T00:00:00.000Z");
  });

  it("keeps each item's length and notes the local time only when the trip is in another zone", () => {
    const [paris] = draftToEvents(draft([{ date: "2026-03-29", items: [{ ...item("01:30", "03:30"), description: "팁" }] }], "Europe/Paris"), "Asia/Seoul");
    expect(paris.startsAt.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(paris.endsAt.getTime() - paris.startsAt.getTime()).toBe(2 * 60 * 60_000); // never before the start, even on DST night
    expect(paris.description).toBe("현지 01:30–03:30 · Europe/Paris\n팁");

    const [home] = draftToEvents(draft([{ date: "2026-10-09", items: [item("09:00", "10:00")] }]), "Asia/Seoul");
    expect(home.description).toBeNull();
  });
});

describe("trip request", () => {
  it("grows the output cap with the trip but stays under one non-streaming call", () => {
    expect(tripMaxOutputTokens(1)).toBe(5_600);
    expect(tripMaxOutputTokens(7)).toBe(15_200);
    expect(buildTripRequest(input).maxOutputTokens).toBe(tripMaxOutputTokens(3));
  });

  it("prices the largest form of a length at or above any real form of that length", () => {
    const ceiling = ceilingRates(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);
    const cost = (request: ReturnType<typeof buildTripRequest>) =>
      reserveCredits(estimateInputTokens(requestText(request)), request.maxOutputTokens, ceiling);
    const real = buildTripRequest({ ...input, destination: "오사카", interests: ["FOOD", "SHOPPING"], request: "유니버설 스튜디오 하루" });
    expect(cost(buildTripRequest(largestTripInput(3)))).toBeGreaterThanOrEqual(cost(real));
    expect(largestTripInput(7)).toMatchObject({ startDate: "2026-01-01", endDate: "2026-01-07" });
  });

  it("answers locally (mock) with an itinerary that passes every check", () => {
    const reply = mockTripReply(buildTripRequest(input));
    const parsed = parseDraft(reply.text!, input);
    expect(parsed.days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(parsed.days[0].items[0].category).toBe("MOVE");
  });
});
