import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PERSONAL_CALENDAR_NAME,
  LEGACY_DEFAULT_PERSONAL_CALENDAR_NAMES,
} from "@/lib/calendar-defaults";

const writableRoles = ["OWNER", "ADMIN", "EDITOR"] as const;

export async function getWritableCalendar(calendarId: string, userId: string) {
  return prisma.calendar.findFirst({
    where: {
      id: calendarId,
      members: {
        some: {
          userId,
          role: {
            in: [...writableRoles],
          },
        },
      },
    },
  });
}

export async function getDefaultPersonalCalendar(userId: string) {
  const existingCalendar = await prisma.calendar.findFirst({
    where: {
      type: "PERSONAL",
      members: {
        some: {
          userId,
          role: "OWNER",
        },
      },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (existingCalendar) {
    if (LEGACY_DEFAULT_PERSONAL_CALENDAR_NAMES.includes(existingCalendar.name)) {
      return prisma.calendar.update({
        where: {
          id: existingCalendar.id,
        },
        data: {
          name: DEFAULT_PERSONAL_CALENDAR_NAME,
        },
      });
    }

    return existingCalendar;
  }

  return prisma.calendar.create({
    data: {
      name: DEFAULT_PERSONAL_CALENDAR_NAME,
      type: "PERSONAL",
      isDefault: true,
      members: {
        create: {
          userId,
          role: "OWNER",
        },
      },
    },
  });
}

export async function getWritableEvent(eventId: string, userId: string) {
  return prisma.event.findFirst({
    where: {
      id: eventId,
      OR: [
        { createdById: userId },
        {
          calendar: {
            members: {
              some: {
                userId,
                role: {
                  in: [...writableRoles],
                },
              },
            },
          },
        },
      ],
    },
    include: {
      calendar: true,
    },
  });
}
