import { z } from "zod";

const calendarBaseSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["PERSONAL", "SHARED"]).default("PERSONAL"),
  color: z.string().min(1).max(32).default("#3F3F46"),
  description: z.string().max(500).optional(),
  timezone: z.string().min(1).max(80).default("Asia/Seoul"),
  /** Defaults to the caller's personal workspace. */
  workspaceId: z.string().min(1).optional(),
});

export const calendarCreateSchema = calendarBaseSchema;

export const calendarUpdateSchema = calendarBaseSchema
  .omit({ type: true, workspaceId: true })
  .partial()
  .refine((calendar) => Object.keys(calendar).length > 0, {
    message: "At least one calendar field is required.",
  });
