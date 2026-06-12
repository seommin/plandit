import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { proxyInternalApi } from "@/lib/api-client";

type CalendarMemberRouteContext = {
  params: Promise<{
    calendarId: string;
    memberId: string;
  }>;
};

export async function PATCH(request: Request, context: CalendarMemberRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { calendarId, memberId } = await context.params;

  return proxyInternalApi(
    request,
    `/calendars/${calendarId}/members/${memberId}`,
    session.user.id,
  );
}

export async function DELETE(request: Request, context: CalendarMemberRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { calendarId, memberId } = await context.params;

  return proxyInternalApi(
    request,
    `/calendars/${calendarId}/members/${memberId}`,
    session.user.id,
  );
}
