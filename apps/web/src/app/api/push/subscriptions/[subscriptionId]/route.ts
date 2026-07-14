import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { proxyInternalApi } from "@/lib/api-client";

type RouteContext = {
  params: Promise<{
    subscriptionId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { subscriptionId } = await context.params;

  return proxyInternalApi(
    request,
    `/push/subscriptions/${subscriptionId}`,
    session.user.id,
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { subscriptionId } = await context.params;

  return proxyInternalApi(
    request,
    `/push/subscriptions/${subscriptionId}`,
    session.user.id,
  );
}
