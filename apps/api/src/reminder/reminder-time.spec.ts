import { fireAtFor, localHourOnDate } from "./reminder-time";

describe("fireAtFor", () => {
  it("timed events: start minus minutesBefore", () => {
    const startsAt = new Date("2026-10-01T01:00:00.000Z"); // 10:00 KST
    expect(fireAtFor({ startsAt, allDay: false }, 30, "Asia/Seoul").toISOString()).toBe("2026-10-01T00:30:00.000Z");
    expect(fireAtFor({ startsAt, allDay: false }, 0, "Asia/Seoul").toISOString()).toBe(startsAt.toISOString());
  });

  it("all-day events fire at 09:00 local on the start date, whether start is stored as UTC or local midnight", () => {
    const utcMidnight = new Date("2026-10-01T00:00:00.000Z");
    const kstMidnight = new Date("2026-09-30T15:00:00.000Z"); // 2026-10-01 00:00 KST
    for (const startsAt of [utcMidnight, kstMidnight]) {
      expect(fireAtFor({ startsAt, allDay: true }, 0, "Asia/Seoul").toISOString()).toBe("2026-10-01T00:00:00.000Z");
      // "a day before" → 09:00 KST on Sep 30
      expect(fireAtFor({ startsAt, allDay: true }, 1440, "Asia/Seoul").toISOString()).toBe("2026-09-30T00:00:00.000Z");
    }
  });

  it("respects DST in the calendar timezone", () => {
    // US DST starts 2026-03-08: 09:00 that day is EDT (UTC-4), the day before is EST (UTC-5).
    expect(localHourOnDate(new Date("2026-03-08T12:00:00Z"), "America/New_York", 9).toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(localHourOnDate(new Date("2026-03-07T12:00:00Z"), "America/New_York", 9).toISOString()).toBe("2026-03-07T14:00:00.000Z");
  });
});
