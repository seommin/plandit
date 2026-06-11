import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { proxyInternalApi } from "@/lib/api-client";

type CalendarInvitesRouteContext = {
  params: Promise<{
    calendarId: string;
  }>;
};

export async function POST(request: Request, context: CalendarInvitesRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { calendarId } = await context.params;

  return proxyInternalApi(request, `/calendars/${calendarId}/invites`, session.user.id);
}
