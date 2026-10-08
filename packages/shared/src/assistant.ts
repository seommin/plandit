import { z } from "zod";

/** AI schedule assistant (PLANDIT-21): what a person sends, and how the screen names each tool. */
export const ASSISTANT_MESSAGE_MAX = 1_000;

export const assistantMessageSchema = z.object({
  text: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX),
});

/** Shown in the step list ("일정 확인") and on the approval card */
export const ASSISTANT_TOOL_LABELS: Record<string, string> = {
  list_calendars: "캘린더 확인",
  list_members: "멤버 확인",
  list_events: "일정 확인",
  find_free_slots: "빈 시간 찾기",
  search_memory: "회의록 찾기",
  create_event: "일정 만들기",
};
