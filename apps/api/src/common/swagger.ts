import { applyDecorators } from "@nestjs/common";
import { ApiResponse } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";

import { ERROR_STATUS, ErrorCode } from "./api-error";

/** The one error body every endpoint returns (ApiExceptionFilter). Registered as components.schemas.ApiError. */
export const API_ERROR_SCHEMA = {
  type: "object" as const,
  required: ["code", "message", "traceId"],
  properties: {
    code: { type: "string" as const, enum: Object.values(ErrorCode), description: "기계가 읽는 오류 코드. 화면 문구는 이 값으로 고른다." },
    message: { type: "string" as const, description: "개발자용 설명(영문)" },
    details: { description: "검증 오류(VALIDATION_FAILED)면 필드별 사유 목록", nullable: true },
    traceId: { type: "string" as const, description: "응답 헤더 x-trace-id와 같은 값. 로그·감사 기록·작업까지 이어진다." },
  },
};

const DESCRIPTIONS: Record<ErrorCode, string> = {
  [ErrorCode.BAD_REQUEST]: "요청 형식이 잘못됨",
  [ErrorCode.VALIDATION_FAILED]: "입력값 검증 실패(details에 필드별 사유)",
  [ErrorCode.UNAUTHORIZED]: "인증 실패(내부 비밀값·API 키·웹훅 서명)",
  [ErrorCode.FORBIDDEN]: "권한 부족(역할·스코프)",
  [ErrorCode.NOT_FOUND]: "없거나 볼 권한이 없음(존재 여부를 드러내지 않음)",
  [ErrorCode.CONFLICT]: "현재 상태와 충돌",
  [ErrorCode.USER_NOT_FOUND]: "해당 이메일로 가입한 사용자가 없음",
  [ErrorCode.ALREADY_MEMBER]: "이미 멤버임",
  [ErrorCode.PERSONAL_WORKSPACE]: "개인 워크스페이스에는 멤버를 추가할 수 없음",
  [ErrorCode.INSUFFICIENT_CREDITS]: "크레딧 잔액 부족",
  [ErrorCode.IDEMPOTENCY_CONFLICT]: "같은 멱등키로 다른 내용을 요청함",
  [ErrorCode.INTERNAL_ERROR]: "서버 내부 오류",
  [ErrorCode.PAYMENT_GATEWAY_ERROR]: "PG 호출 실패(결제는 RESERVE로 남고 재조회로 확정)",
  [ErrorCode.RATE_LIMITED]: "요청 수 제한 초과(Retry-After 헤더)",
  [ErrorCode.SERVICE_UNAVAILABLE]: "의존 서비스(DB·Redis) 응답 없음",
  [ErrorCode.ATTENDEE_NOT_ELIGIBLE]: "함께 갈 수 없는 사람(워크스페이스 멤버가 아님, 개인 캘린더). details에 userId 목록",
  [ErrorCode.CALENDAR_MEMBERS_CHANGED]: "캘린더에 새로 추가될 사람이 확인한 목록과 다름. details.newCalendarMemberIds로 다시 확인",
  [ErrorCode.AI_MONTHLY_LIMIT]: "이번 호출의 선차감액을 더하면 워크스페이스의 AI 월 한도를 넘음. details에 limit·used·requested·resetsAt",
  [ErrorCode.DOCUMENT_UNREADABLE]: "PDF·TXT·MD가 아니거나, 글자를 읽을 수 없음(스캔한 PDF, 깨진 파일, 빈 파일). details.reason",
  [ErrorCode.TRIP_DRAFT_CHANGED]: "AI에게 고쳐 달라고 한 뒤 초안이 바뀌었음(손으로 고침 등). 제안을 버리고 다시 요청",
};

const MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.BAD_REQUEST]: "Bad request.",
  [ErrorCode.VALIDATION_FAILED]: "Invalid request.",
  [ErrorCode.UNAUTHORIZED]: "Unauthorized.",
  [ErrorCode.FORBIDDEN]: "Forbidden.",
  [ErrorCode.NOT_FOUND]: "Not found.",
  [ErrorCode.CONFLICT]: "Conflict.",
  [ErrorCode.USER_NOT_FOUND]: "User not found.",
  [ErrorCode.ALREADY_MEMBER]: "Already a member.",
  [ErrorCode.PERSONAL_WORKSPACE]: "Personal workspaces cannot have other members.",
  [ErrorCode.INSUFFICIENT_CREDITS]: "Not enough credits.",
  [ErrorCode.IDEMPOTENCY_CONFLICT]: "Idempotency key reused with a different request.",
  [ErrorCode.INTERNAL_ERROR]: "Internal server error.",
  [ErrorCode.PAYMENT_GATEWAY_ERROR]: "Payment gateway request failed.",
  [ErrorCode.RATE_LIMITED]: "Too many requests.",
  [ErrorCode.SERVICE_UNAVAILABLE]: "Service unavailable.",
  [ErrorCode.ATTENDEE_NOT_ELIGIBLE]: "Some attendees cannot join this trip.",
  [ErrorCode.CALENDAR_MEMBERS_CHANGED]: "The people to add to the calendar changed.",
  [ErrorCode.AI_MONTHLY_LIMIT]: "This call would go over the workspace's monthly AI credit limit.",
  [ErrorCode.DOCUMENT_UNREADABLE]: "No readable text in this file.",
  [ErrorCode.TRIP_DRAFT_CHANGED]: "The draft changed after this revision was requested.",
};

const TRACE_ID = "0d85ad5d-c5b6-4cf3-ba9f-b27e7906d209";

/**
 * Error responses an endpoint can return, grouped by HTTP status with one example per code:
 * `@ApiErrors(ErrorCode.FORBIDDEN, ErrorCode.NOT_FOUND)`.
 */
export function ApiErrors(...codes: ErrorCode[]) {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) byStatus.set(ERROR_STATUS[code], [...(byStatus.get(ERROR_STATUS[code]) ?? []), code]);

  return applyDecorators(
    ...[...byStatus].map(([status, list]) =>
      ApiResponse({
        status,
        description: list.map((code) => `${code}: ${DESCRIPTIONS[code]}`).join(" / "),
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiError" },
            examples: Object.fromEntries(
              list.map((code) => [
                code,
                {
                  summary: DESCRIPTIONS[code],
                  value:
                    code === ErrorCode.VALIDATION_FAILED
                      ? { code, message: MESSAGES[code], details: [{ path: "amount", message: "Too small: expected number to be >=1000" }], traceId: TRACE_ID }
                      : { code, message: MESSAGES[code], traceId: TRACE_ID },
                },
              ]),
            ),
          },
        },
      }),
    ),
  );
}

/** Tag order and descriptions for the docs page (Swagger groups by the first tag of each operation). */
export const TAGS: Array<[name: string, description: string]> = [
  ["워크스페이스", "과금·권한의 단위. 역할 OWNER > ADMIN > MEMBER. 권한 없는 워크스페이스는 404, 역할 부족은 403"],
  ["크레딧", "잔액과 원장(append-only). 잔액은 원장에서 파생된 캐시이고 직접 바꾸지 않는다"],
  ["결제", "충전: RESERVE 기록 → PG 결제 페이지 → 웹훅으로 승인·실패 확정. 웹훅이 없어도 재조회 작업이 확정"],
  ["리마인더", "일정 알림 설정과 발송 내역. 유료 채널(문자·알림톡)은 발송 전에 차감, 실패하면 환불"],
  ["AI 여행 일정", "목적지·기간·함께 갈 멤버로 AI가 여행 일정 초안을 만들고, 확인·수정한 뒤 캘린더에 한 번에 넣는다. 초안은 만든 사람만 본다"],
  ["AI 일정 비서", "대화로 일정을 확인하고 빈 시간을 찾고 일정을 만든다. AI가 도구를 여러 번 부르고(Tool Calling), 일정을 바꾸는 도구는 사용자가 승인해야 실행된다. 대화는 만든 사람만 본다"],
  ["AI", "LLM 호출 과금 내역. 호출 전에 최대 크레딧을 선차감하고, 끝나면 실사용만 청구하고 나머지를 돌려준다. 실패하면 전액 환불"],
  ["캘린더", "캘린더·멤버·초대. 캘린더 역할(OWNER/ADMIN/EDITOR/VIEWER)은 데이터 권한"],
  ["일정", "일정 만들기·수정·삭제·중요 표시"],
  ["회의록", "일정에 붙이는 회의록(PDF·TXT·MD). 글자만 뽑아 조각으로 저장하고 임베딩해, 그 일정을 볼 수 있는 사람이 AI 비서에게 물으면 근거로 찾아진다"],
  ["공유", "공개 일정 링크"],
  ["푸시", "웹 푸시 구독"],
  ["API 키", "공개 API(/v1)용 키 발급·폐기. 원문은 발급 응답에만 한 번 나온다"],
  ["공개 API (v1)", "외부 연동용. `Authorization: Bearer pk_…`, 스코프·요청 수 제한"],
  ["감사 로그", "워크스페이스의 멤버·역할·결제·크레딧 변경 기록(수정·삭제 불가)"],
  ["웹훅", "PG·문자 중계사가 부르는 경로. 내부 비밀값 대신 원문 본문의 HMAC-SHA256 서명(`x-mock-signature`)으로 인증"],
  ["내 정보", "로그인한 사용자 정보와 문자 수신 번호"],
  ["인증", "가입·비밀번호 재설정(web 서버의 Auth.js가 호출)"],
  ["운영", "플랫폼 운영자(PLATFORM_ADMIN_EMAILS)만. 장애 복구용 수동 실행"],
  ["상태", "헬스 체크"],
];

/**
 * Registers ApiError, and fixes auth per path: webhooks use a signature and /health is open (no security),
 * /v1 uses an API key; everything else is called by the web server, so it gets the shared 401.
 */
export function finishDocument(document: OpenAPIObject) {
  document.components = { ...document.components, schemas: { ...document.components?.schemas, ApiError: API_ERROR_SCHEMA } };
  for (const [path, item] of Object.entries(document.paths)) {
    for (const operation of Object.values(item) as Array<{ security?: unknown[]; responses?: Record<string, unknown> }>) {
      if (path.startsWith("/webhooks") || path === "/health") operation.security = [];
      else if (path.startsWith("/v1")) operation.security = [{ "api-key": [] }];
      else {
        operation.responses = {
          ...operation.responses,
          401: {
            description: "UNAUTHORIZED: web 서버 전용 헤더(x-api-secret, x-user-id)가 없거나 틀림",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" }, example: { code: "UNAUTHORIZED", message: "Invalid internal API secret.", traceId: TRACE_ID } } },
          },
        };
      }
    }
  }
  return document;
}
