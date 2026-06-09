import { prisma } from "@/lib/prisma";

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
    return existingCalendar;
  }

  return prisma.calendar.create({
    data: {
      name: "Private",
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
