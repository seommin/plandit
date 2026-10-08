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
  // Bytes, not text: a file upload (multipart) would be corrupted by decoding it as UTF-8.
  const raw = ["GET", "HEAD"].includes(method) ? undefined : await request.arrayBuffer();
  const body = raw?.byteLength ? raw : undefined;
  const headers = new Headers();
  if (body) headers.set("content-type", request.headers.get("content-type") ?? "application/json");
  // The api records these in audit logs; without them every change would look like it came from this server.
  const forwardedFor = request.headers.get("x-forwarded-for");
  const userAgent = request.headers.get("user-agent");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  if (userAgent) headers.set("x-client-user-agent", userAgent);
  // Lets the api recognise a retried request (e.g. "만들기" pressed twice) and do the work once.
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

  const response = await fetchInternalApi(path, { body, method, userId, headers });
  const responseBody = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";

  // 204/304 must not carry a body (the Response constructor throws).
  return new NextResponse(response.status === 204 || response.status === 304 ? null : responseBody, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  });
}
