import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { proxyInternalApi } from "@/lib/api-client";

type CalendarMembersRouteContext = {
  params: Promise<{
    calendarId: string;
  }>;
};

export async function GET(request: Request, context: CalendarMembersRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { calendarId } = await context.params;

  return proxyInternalApi(request, `/calendars/${calendarId}/members`, session.user.id);
}
