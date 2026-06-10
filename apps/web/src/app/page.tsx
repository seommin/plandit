import { redirect } from "next/navigation";

import { auth } from "@/auth";
import CalendarApp, {
  type CalendarAppCalendar,
  type CalendarAppEvent,
} from "@/app/calendar-app";
import { readInternalApi } from "@/lib/api-client";

export default async function Home() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const from = new Date(Date.UTC(2026, 5, 1));
  const to = new Date(Date.UTC(2026, 6, 1));
  const state = await readInternalApi<{
    calendars: CalendarAppCalendar[];
    events: CalendarAppEvent[];
  }>(
    `/calendar/state?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(
      to.toISOString(),
    )}`,
    { userId: session.user.id },
  );

  return (
    <CalendarApp
      calendars={state.calendars}
      events={state.events}
      user={{
        email: session.user.email ?? "",
        id: session.user.id,
        name: session.user.name ?? "Plandit user",
      }}
    />
  );
}
