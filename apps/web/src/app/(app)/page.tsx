import { auth } from "@/auth";
import { CalendarScreen } from "@/app/(app)/calendar-screen";
import { readInternalApi } from "@/lib/api-client";
import { DAY_MS, monthGridRange } from "@/lib/dates";
import type { CalendarState } from "@/lib/types";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await auth();
  const month = new Date();
  month.setDate(1);
  // This month in the server's time zone, plus a day each side: the viewer's grid, up to 14 hours away, still fits.
  // Near the 1st their month can differ altogether; the client sees `range` doesn't cover it and fetches its own.
  const grid = monthGridRange(month);
  const from = new Date(grid.from.getTime() - DAY_MS).toISOString();
  const to = new Date(grid.to.getTime() + DAY_MS).toISOString();
  const state = await readInternalApi<CalendarState>(`/calendar/state?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    userId: session!.user!.id,
  });

  return <CalendarScreen initial={{ ...state, range: { from, to } }} openCreate={(await searchParams).new === "1"} />;
}
