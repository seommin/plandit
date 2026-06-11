import { z } from "zod";

const calendarBaseSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["PERSONAL", "SHARED"]).default("PERSONAL"),
  color: z.string().min(1).max(32).default("#2F6BFF"),
  description: z.string().max(500).optional(),
  timezone: z.string().min(1).max(80).default("Asia/Seoul"),
});

export const calendarCreateSchema = calendarBaseSchema;

export const calendarUpdateSchema = calendarBaseSchema
  .omit({ type: true })
  .partial()
  .refine((calendar) => Object.keys(calendar).length > 0, {
    message: "At least one calendar field is required.",
  });
