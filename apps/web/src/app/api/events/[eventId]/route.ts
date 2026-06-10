import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { proxyInternalApi } from "@/lib/api-client";

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

  return proxyInternalApi(request, `/events/${eventId}`, session.user.id);
}

export async function DELETE(request: Request, context: EventRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await context.params;

  return proxyInternalApi(request, `/events/${eventId}`, session.user.id);
}
