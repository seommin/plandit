/** Browser-side calls to /api/* (the authenticated proxy in app/api/[...path]). */

const MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: "입력한 내용을 다시 확인해주세요.",
  UNAUTHORIZED: "로그인이 필요합니다.",
  FORBIDDEN: "이 작업을 할 권한이 없어요.",
  NOT_FOUND: "찾을 수 없어요. 이미 삭제되었거나 권한이 없을 수 있어요.",
  USER_NOT_FOUND: "가입된 사용자가 아니에요.",
  ALREADY_MEMBER: "이미 멤버예요.",
  PERSONAL_WORKSPACE: "개인 워크스페이스에는 다른 사람을 초대할 수 없어요.",
  INSUFFICIENT_CREDITS: "크레딧이 부족해요.",
  PAYMENT_GATEWAY_ERROR: "결제 서비스에 연결하지 못했어요. 잠시 후 다시 시도해주세요.",
  RATE_LIMITED: "요청이 너무 많아요. 잠시 후 다시 시도해주세요.",
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (response.status === 204) return undefined as T;

  const data = (await response.json().catch(() => ({}))) as { code?: string; message?: string; error?: string };
  if (!response.ok) {
    const message = (data.code && MESSAGES[data.code]) || data.message || data.error || "잠시 후 다시 시도해주세요.";
    throw new ApiRequestError(message, response.status, data.code);
  }
  return data as T;
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "잠시 후 다시 시도해주세요.");
