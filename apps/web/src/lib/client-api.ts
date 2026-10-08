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
  CONFLICT: "지금 상태에서는 할 수 없어요. 새로 고친 뒤 다시 시도해주세요.",
  IDEMPOTENCY_CONFLICT: "같은 요청이 이미 다른 내용으로 처리됐어요. 새로 고친 뒤 다시 시도해주세요.",
  ATTENDEE_NOT_ELIGIBLE: "함께 갈 수 없는 사람이 있어요. 워크스페이스 멤버인지 확인해주세요.",
  CALENDAR_MEMBERS_CHANGED: "캘린더에 새로 추가될 사람이 바뀌었어요. 다시 확인해주세요.",
  AI_MONTHLY_LIMIT: "이번 달 AI 사용 한도를 넘어요. 워크스페이스 관리자가 크레딧 화면에서 한도를 바꿀 수 있어요.",
  TRIP_DRAFT_CHANGED: "AI에게 요청한 뒤 초안이 바뀌었어요. 고친 내용을 확인하고 다시 요청해 주세요.",
  DOCUMENT_UNREADABLE: "글자를 읽을 수 없는 파일이에요. PDF·TXT·MD만 되고, 스캔한 PDF처럼 그림뿐인 파일은 안 돼요.",
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  // A FormData body (file upload) goes as multipart with the boundary the browser picks; anything else as JSON.
  const form = init.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { ...(init.body === undefined || form ? {} : { "content-type": "application/json" }), ...init.headers },
    body: init.body === undefined ? undefined : form ? (init.body as FormData) : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (response.status === 204) return undefined as T;

  const data = (await response.json().catch(() => ({}))) as { code?: string; message?: string; error?: string; details?: unknown };
  if (!response.ok) {
    const message = (data.code && MESSAGES[data.code]) || data.message || data.error || "잠시 후 다시 시도해주세요.";
    throw new ApiRequestError(message, response.status, data.code, data.details);
  }
  return data as T;
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "잠시 후 다시 시도해주세요.");
