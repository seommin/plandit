import { UnauthorizedException } from "@nestjs/common";

import { prisma } from "@plandit/database/prisma";
import {
  DEFAULT_PERSONAL_CALENDAR_NAME,
  LEGACY_DEFAULT_PERSONAL_CALENDAR_NAMES,
} from "@plandit/shared/calendar-defaults";

import { ensurePersonalWorkspace } from "../workspace/personal-workspace";

const writableRoles = ["OWNER", "ADMIN", "EDITOR"] as const;
const manageableRoles = ["OWNER", "ADMIN"] as const;

export async function assertExistingUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new UnauthorizedException("Invalid user context.");
  }

  return user;
}

export async function getCalendarMembership(calendarId: string, userId: string) {
  return prisma.calendarMember.findUnique({
    where: {
      calendarId_userId: {
        calendarId,
        userId,
      },
    },
    include: {
      calendar: true,
    },
  });
}

export async function getManageableCalendar(calendarId: string, userId: string) {
  return prisma.calendar.findFirst({
    where: {
      id: calendarId,
      members: {
        some: {
          userId,
          role: {
            in: [...manageableRoles],
          },
        },
      },
    },
  });
}

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
  await assertExistingUser(userId);
  const workspace = await ensurePersonalWorkspace(userId);

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
      workspaceId: workspace.id,
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
