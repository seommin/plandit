import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { proxyInternalApi } from "@/lib/api-client";

type InviteAcceptRouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export async function POST(request: Request, context: InviteAcceptRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { token } = await context.params;

  return proxyInternalApi(request, `/invites/${token}/accept`, session.user.id);
}
