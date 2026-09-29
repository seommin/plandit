import { z } from "zod";

export const REMINDER_CHANNELS = ["PUSH", "SMS", "ALIMTALK"] as const;
export type ReminderChannelName = (typeof REMINDER_CHANNELS)[number];

/** Credits per delivery. Push is free; SMS and AlimTalk go through the (mock) carrier. */
export const CHANNEL_CREDITS: Record<ReminderChannelName, number> = { PUSH: 0, SMS: 1, ALIMTALK: 1 };

/** All-day events have no start time; their reminders count back from this local hour on the start date. */
export const ALL_DAY_REMINDER_HOUR = 9;

export const reminderSetSchema = z.object({
  reminders: z
    .array(
      z.object({
        minutesBefore: z.number().int().min(0).max(10_080),
        channel: z.enum(REMINDER_CHANNELS),
        audience: z.enum(["CREATOR", "ATTENDEES"]).default("CREATOR"),
      }),
    )
    .max(5)
    .refine(
      (list) => new Set(list.map((r) => `${r.minutesBefore}:${r.channel}`)).size === list.length,
      "Each (minutesBefore, channel) pair can appear only once.",
    ),
});

/** Korean mobile number → digits only ("010-0000-0001" → "01000000001"). */
export const phoneSchema = z
  .string()
  .regex(/^01\d-?\d{3,4}-?\d{4}$/, "Use a mobile number like 010-0000-0001.")
  .transform((value) => value.replace(/-/g, ""));

export const profileUpdateSchema = z.object({ phone: phoneSchema.nullable() });
