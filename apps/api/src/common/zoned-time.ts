type Parts = Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;

/** Wall-clock fields of `instant` in `timeZone`. */
export function partsIn(instant: number, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)])) as Parts;
}

/** UTC offset of `timeZone` at `instant`, in ms (Asia/Seoul → +9h). */
function offsetAt(instant: number, timeZone: string) {
  const p = partsIn(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a wall clock in `timeZone` shows these fields (month is 1-12). Two passes so a DST change between the
 * guess and the answer still lands on the right offset. A time DST skips moves forward by the gap (Paris 02:30 → 03:30).
 */
export function wallClockToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const first = wallClock - offsetAt(wallClock, timeZone);
  return new Date(wallClock - offsetAt(first, timeZone));
}

/** True for a time zone name the runtime knows (IANA names like "Europe/Paris", plus "UTC"). */
export function isTimeZone(name: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
