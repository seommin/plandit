import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { proxyInternalApi } from "@/lib/api-client";

/**
 * One authenticated pass-through for the whole API: /api/<path> → api /<path> as the signed-in user.
 * Authorization stays in the api (every endpoint checks the user's roles); this layer only proves who the user is.
 * More specific routes (api/auth/*) still win over this catch-all.
 */
const NOT_PROXIED = /^(webhooks|metrics|v1|health)(\/|$)/; // machine endpoints with their own auth

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "로그인이 필요합니다." }, { status: 401 });
  }

  const path = (await context.params).path.map(encodeURIComponent).join("/");
  if (NOT_PROXIED.test(path)) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Not found." }, { status: 404 });
  }
  return proxyInternalApi(request, `/${path}${new URL(request.url).search}`, session.user.id);
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
