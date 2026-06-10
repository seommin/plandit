import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { proxyInternalApi } from "@/lib/api-client";

type EventShareRouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function POST(request: Request, context: EventShareRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await context.params;

  return proxyInternalApi(request, `/events/${eventId}/shares`, session.user.id);
}
