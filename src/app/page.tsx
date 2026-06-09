import { redirect } from "next/navigation";

import { auth } from "@/auth";
import CalendarApp, {
  type CalendarAppCalendar,
  type CalendarAppEvent,
} from "@/app/calendar-app";
import { getDefaultPersonalCalendar } from "@/lib/event-permissions";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  await getDefaultPersonalCalendar(session.user.id);

  const calendars = await prisma.calendar.findMany({
    where: {
      members: {
        some: {
          userId: session.user.id,
        },
      },
    },
    include: {
      members: {
        where: {
          userId: session.user.id,
        },
        select: {
          role: true,
        },
      },
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });

  const from = new Date(Date.UTC(2026, 5, 1));
  const to = new Date(Date.UTC(2026, 6, 1));

  const events = await prisma.event.findMany({
    where: {
      startsAt: {
        lt: to,
      },
      endsAt: {
        gte: from,
      },
      OR: [
        {
          visibility: "PRIVATE",
          createdById: session.user.id,
        },
        {
          visibility: {
            in: ["CALENDAR", "PUBLIC_LINK"],
          },
          calendar: {
            members: {
              some: {
                userId: session.user.id,
              },
            },
          },
        },
      ],
    },
    include: {
      calendar: {
        select: {
          id: true,
          name: true,
          type: true,
          color: true,
        },
      },
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
  });

  const appCalendars: CalendarAppCalendar[] = calendars.map((calendar) => ({
    id: calendar.id,
    name: calendar.name,
    type: calendar.type,
    color: calendar.color,
    role: calendar.members[0]?.role ?? "VIEWER",
  }));

  const appEvents: CalendarAppEvent[] = events.map((event) => ({
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    description: event.description,
    location: event.location,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    allDay: event.allDay,
    color: event.color ?? event.calendar.color,
    visibility: event.visibility,
    calendar: event.calendar,
  }));

  return (
    <CalendarApp
      calendars={appCalendars}
      events={appEvents}
      user={{
        email: session.user.email ?? "",
        id: session.user.id,
        name: session.user.name ?? "Plandit user",
      }}
    />
  );
}
