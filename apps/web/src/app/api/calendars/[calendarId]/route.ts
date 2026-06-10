import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { proxyInternalApi } from "@/lib/api-client";

type CalendarRouteContext = {
  params: Promise<{
    calendarId: string;
  }>;
};

export async function PATCH(request: Request, context: CalendarRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { calendarId } = await context.params;

  return proxyInternalApi(request, `/calendars/${calendarId}`, session.user.id);
}

export async function DELETE(request: Request, context: CalendarRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { calendarId } = await context.params;

  return proxyInternalApi(request, `/calendars/${calendarId}`, session.user.id);
}
