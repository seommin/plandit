import { auth } from "@/auth";
import { CalendarScreen } from "@/app/(app)/calendar-screen";
import { readInternalApi } from "@/lib/api-client";
import { monthGridRange } from "@/lib/dates";
import type { CalendarState } from "@/lib/types";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await auth();
  const month = new Date();
  month.setDate(1);
  const { from, to } = monthGridRange(month);
  const initial = await readInternalApi<CalendarState>(
    `/calendar/state?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    { userId: session!.user!.id },
  );

  return <CalendarScreen initial={initial} openCreate={(await searchParams).new === "1"} />;
}
