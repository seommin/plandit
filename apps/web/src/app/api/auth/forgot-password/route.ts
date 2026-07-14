import { proxyInternalApi } from "@/lib/api-client";

export async function POST(request: Request) {
  return proxyInternalApi(request, "/auth/forgot-password");
}
