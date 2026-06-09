import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { eventCreateSchema } from "@/lib/event-input";
import {
  getDefaultPersonalCalendar,
  getWritableCalendar,
} from "@/lib/event-permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const calendarId = url.searchParams.get("calendarId");

  const events = await prisma.event.findMany({
    where: {
      ...(calendarId ? { calendarId } : {}),
      ...(from || to
        ? {
            startsAt: {
              ...(to ? { lte: new Date(to) } : {}),
            },
            endsAt: {
              ...(from ? { gte: new Date(from) } : {}),
            },
          }
        : {}),
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
      attendees: true,
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json();
  const parsed = eventCreateSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  }

  const calendar = parsed.data.calendarId
    ? await getWritableCalendar(parsed.data.calendarId, session.user.id)
    : await getDefaultPersonalCalendar(session.user.id);

  if (!calendar) {
    return NextResponse.json({ error: "Calendar not found." }, { status: 404 });
  }

  const visibility =
    parsed.data.visibility ?? (calendar.type === "PERSONAL" ? "PRIVATE" : "CALENDAR");

  const event = await prisma.event.create({
    data: {
      calendarId: calendar.id,
      createdById: session.user.id,
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
      allDay: parsed.data.allDay,
      color: parsed.data.color,
      visibility,
    },
  });

  return NextResponse.json({ event }, { status: 201 });
}
