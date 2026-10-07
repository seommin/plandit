import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

import { type CalendarRole, prisma } from "@plandit/database/prisma";
import {
  DEFAULT_PERSONAL_CALENDAR_NAME,
  LEGACY_DEFAULT_PERSONAL_CALENDAR_NAMES,
} from "@plandit/shared/calendar-defaults";

import { ensurePersonalWorkspace } from "../workspace/personal-workspace";

const writableRoles: CalendarRole[] = ["OWNER", "ADMIN", "EDITOR"];
const manageableRoles: CalendarRole[] = ["OWNER", "ADMIN"];

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

/**
 * null when the user is not on the calendar (or it is outside `workspaceId`): callers answer 404 so its existence stays hidden.
 * A member whose role is too low already sees the calendar, so that is a 403.
 */
async function getCalendarWithRole(calendarId: string, userId: string, roles: CalendarRole[], workspaceId?: string) {
  const membership = await getCalendarMembership(calendarId, userId);

  if (!membership || (workspaceId && membership.calendar.workspaceId !== workspaceId)) {
    return null;
  }

  if (!roles.includes(membership.role)) {
    throw new ForbiddenException("Your calendar role does not allow this.");
  }

  return membership.calendar;
}

export async function getManageableCalendar(calendarId: string, userId: string) {
  return getCalendarWithRole(calendarId, userId, manageableRoles);
}

export async function getWritableCalendar(calendarId: string, userId: string, workspaceId?: string) {
  return getCalendarWithRole(calendarId, userId, writableRoles, workspaceId);
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

/**
 * null when the user cannot see the event (404) — including someone else's PRIVATE event, even for OWNER·ADMIN·EDITOR.
 * 403 when they can see it but their calendar role cannot change it.
 */
export async function getWritableEvent(eventId: string, userId: string) {
  const event = await prisma.event.findUnique({
    where: {
      id: eventId,
    },
    include: {
      calendar: {
        include: {
          members: {
            where: {
              userId,
            },
            select: {
              role: true,
            },
          },
        },
      },
    },
  });
  const role = event?.calendar.members[0]?.role;

  // Same visibility as the event list: someone else's PRIVATE event is invisible to every member, whatever the role.
  if (!event || (event.visibility === "PRIVATE" && event.createdById !== userId)) {
    return null;
  }

  if (event.createdById === userId || (role && writableRoles.includes(role))) {
    return event;
  }

  if (role) {
    throw new ForbiddenException("Your calendar role does not allow this.");
  }

  return null;
}
