import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { eventUpdateSchema } from "@/lib/event-input";
import {
  getWritableCalendar,
  getWritableEvent,
} from "@/lib/event-permissions";
import { prisma } from "@/lib/prisma";

type EventRouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function PATCH(request: Request, context: EventRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await context.params;
  const payload = await request.json();
  const parsed = eventUpdateSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  }

  const event = await getWritableEvent(eventId, session.user.id);

  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  if (parsed.data.calendarId && parsed.data.calendarId !== event.calendarId) {
    const targetCalendar = await getWritableCalendar(
      parsed.data.calendarId,
      session.user.id,
    );

    if (!targetCalendar) {
      return NextResponse.json(
        { error: "Target calendar not found." },
        { status: 404 },
      );
    }
  }

  const updatedEvent = await prisma.event.update({
    where: { id: eventId },
    data: {
      calendarId: parsed.data.calendarId,
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
      startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : undefined,
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : undefined,
      allDay: parsed.data.allDay,
      color: parsed.data.color,
      visibility: parsed.data.visibility,
    },
  });

  return NextResponse.json({ event: updatedEvent });
}

export async function DELETE(_request: Request, context: EventRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await context.params;
  const event = await getWritableEvent(eventId, session.user.id);

  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  await prisma.event.delete({
    where: { id: eventId },
  });

  return NextResponse.json({ ok: true });
}
