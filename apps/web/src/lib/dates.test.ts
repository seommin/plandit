// Runs with Node's built-in runner (no build step): pnpm --filter @plandit/web test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMonthWeeks, dayTone, formatEventTime, holidayName, monthGridRange, rangeCovers } from "./dates.ts";
import type { CalendarEvent } from "./types.ts";

const event = (id: string, startsAt: Date, endsAt: Date, allDay = false) =>
  ({ id, calendarId: "c", title: id, description: null, location: null, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), allDay, color: "#000", visibility: "PRIVATE", isImportant: false, calendar: { id: "c", name: "c", type: "PERSONAL", color: "#000" } }) satisfies CalendarEvent;

describe("monthGridRange", () => {
  it("starts on the Sunday before the 1st and ends after the last week", () => {
    const { from, to } = monthGridRange(new Date(2026, 8, 1)); // September 2026 starts on a Tuesday
    assert.equal(from.toDateString(), new Date(2026, 7, 30).toDateString());
    assert.equal(to.toDateString(), new Date(2026, 9, 4).toDateString());
  });
});

describe("rangeCovers", () => {
  const grid = monthGridRange(new Date(2026, 9, 1)); // October 2026 in this machine's zone
  const iso = (d: Date) => d.toISOString();

  it("uses fetched data only when it holds the whole range", () => {
    const wide = { from: iso(new Date(grid.from.getTime() - 86_400_000)), to: iso(new Date(grid.to.getTime() + 86_400_000)) };
    assert.equal(rangeCovers(wide, grid.from, grid.to), true);
    assert.equal(rangeCovers({ from: iso(grid.from), to: iso(grid.to) }, grid.from, grid.to), true);
  });

  it("refetches when the server fetched another zone's month (e.g. September while the viewer is already on October 1st)", () => {
    const september = monthGridRange(new Date(2026, 8, 1));
    assert.equal(rangeCovers({ from: iso(september.from), to: iso(september.to) }, grid.from, grid.to), false);
    assert.equal(rangeCovers({ from: iso(grid.from), to: iso(new Date(grid.to.getTime() - 9 * 3_600_000)) }, grid.from, grid.to), false);
    assert.equal(rangeCovers(undefined, grid.from, grid.to), false);
  });
});

describe("buildMonthWeeks", () => {
  const month = new Date(2026, 8, 1);

  it("an all-day event over two days is one bar spanning both, ending before its exclusive end", () => {
    const weeks = buildMonthWeeks(month, [event("trip", new Date(2026, 8, 9), new Date(2026, 8, 11), true)]);
    const bar = weeks[1].bars[0]; // week of Sep 6
    assert.deepEqual([bar.start, bar.span, bar.lane], [3, 2, 0]); // Wed + Thu
  });

  it("an event crossing a week boundary is split and marked as continuing", () => {
    const weeks = buildMonthWeeks(month, [event("long", new Date(2026, 8, 11, 9), new Date(2026, 8, 15, 18))]);
    const [first] = weeks[1].bars;
    const [second] = weeks[2].bars;
    assert.deepEqual([first.start, first.span, first.continuesAfter], [5, 2, true]);
    assert.deepEqual([second.start, second.span, second.continuesBefore], [0, 3, true]);
  });

  it("overlapping events get different lanes; a later non-overlapping one reuses lane 0", () => {
    const weeks = buildMonthWeeks(month, [
      event("a", new Date(2026, 8, 7, 9), new Date(2026, 8, 8, 10)),
      event("b", new Date(2026, 8, 8, 9), new Date(2026, 8, 8, 11)),
      event("c", new Date(2026, 8, 10, 9), new Date(2026, 8, 10, 10)),
    ]);
    const lanes = Object.fromEntries(weeks[1].bars.map((b) => [b.event.id, b.lane]));
    assert.deepEqual(lanes, { a: 0, b: 1, c: 0 });
    assert.equal(weeks[1].laneCount, 2);
  });
});

describe("formatEventTime", () => {
  it("all-day single day, all-day range, and timed", () => {
    assert.equal(formatEventTime(event("x", new Date(2026, 8, 9), new Date(2026, 8, 10), true)), "하루 종일");
    assert.match(formatEventTime(event("y", new Date(2026, 8, 9), new Date(2026, 8, 11), true)), /9월 9일.*9월 10일/);
    assert.equal(formatEventTime(event("z", new Date(2026, 8, 9, 10), new Date(2026, 8, 9, 11, 30))), "10:00 – 11:30");
  });
});

describe("layoutDay", () => {
  const day = new Date(2026, 8, 29);
  it("puts overlapping events side by side and a later one back to full width", async () => {
    const { layoutDay } = await import("./dates.ts");
    const laid = layoutDay(day, [
      event("a", new Date(2026, 8, 29, 10), new Date(2026, 8, 29, 11)),
      event("b", new Date(2026, 8, 29, 10, 30), new Date(2026, 8, 29, 12)),
      event("c", new Date(2026, 8, 29, 14), new Date(2026, 8, 29, 15)),
    ]);
    const byId = Object.fromEntries(laid.map((p) => [p.event.id, [p.startMin, p.column, p.columns]]));
    assert.deepEqual(byId, { a: [600, 0, 2], b: [630, 1, 2], c: [840, 0, 1] });
  });

  it("clips an event that started the day before and skips all-day ones", async () => {
    const { layoutDay } = await import("./dates.ts");
    const laid = layoutDay(day, [
      event("night", new Date(2026, 8, 28, 22), new Date(2026, 8, 29, 2)),
      event("allday", new Date(2026, 8, 29), new Date(2026, 8, 30), true),
    ]);
    assert.deepEqual(laid.map((p) => [p.event.id, p.startMin, p.endMin]), [["night", 0, 120]]);
  });
});

describe("weekends and holidays", () => {
  it("names official holidays, including substitutes", () => {
    assert.equal(holidayName(new Date(2026, 8, 25)), "추석");
    assert.equal(holidayName(new Date(2026, 9, 5)), "대체공휴일(개천절)");
    assert.equal(holidayName(new Date(2026, 8, 29)), undefined);
  });

  it("colors Sundays and holidays red, Saturdays blue", () => {
    assert.equal(dayTone(new Date(2026, 8, 27)), "text-sunday"); // Sunday
    assert.equal(dayTone(new Date(2026, 9, 3)), "text-sunday"); // Saturday, but 개천절
    assert.equal(dayTone(new Date(2026, 9, 10)), "text-saturday");
    assert.equal(dayTone(new Date(2026, 8, 29)), "");
  });
});
