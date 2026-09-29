import { NextResponse } from "next/server";

const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

function getInternalSecret() {
  const secret = process.env.API_INTERNAL_SECRET;

  if (!secret) {
    throw new Error("API_INTERNAL_SECRET is required to call the API server.");
  }

  return secret;
}

export async function fetchInternalApi(
  path: string,
  init: RequestInit & { userId?: string } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("x-api-secret", getInternalSecret());

  if (init.userId) {
    headers.set("x-user-id", init.userId);
  }

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetch(new URL(path, apiBaseUrl), {
    ...init,
    cache: init.cache ?? "no-store",
    headers,
  });
}

export async function readInternalApi<T>(
  path: string,
  init: RequestInit & { userId?: string } = {},
) {
  const response = await fetchInternalApi(path, init);

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export async function proxyInternalApi(
  request: Request,
  path: string,
  userId?: string,
) {
  const method = request.method;
  const body = ["GET", "HEAD"].includes(method) ? undefined : await request.text();
  const headers = new Headers();
  if (body) headers.set("content-type", request.headers.get("content-type") ?? "application/json");
  // The api records these in audit logs; without them every change would look like it came from this server.
  const forwardedFor = request.headers.get("x-forwarded-for");
  const userAgent = request.headers.get("user-agent");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  if (userAgent) headers.set("x-client-user-agent", userAgent);

  const response = await fetchInternalApi(path, { body, method, userId, headers });
  const responseBody = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";

  return new NextResponse(responseBody, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  });
}
