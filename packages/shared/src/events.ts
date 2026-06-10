import { z } from "zod";

const eventBaseSchema = z.object({
  calendarId: z.string().min(1).optional(),
  title: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  location: z.string().max(240).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  allDay: z.boolean().default(false),
  color: z.string().max(32).optional(),
  visibility: z.enum(["PRIVATE", "CALENDAR", "PUBLIC_LINK"]).optional(),
});

export const eventCreateSchema = eventBaseSchema.refine(
  (event) => new Date(event.endsAt) > new Date(event.startsAt),
  {
    message: "endsAt must be after startsAt.",
    path: ["endsAt"],
  },
);

export const eventUpdateSchema = eventBaseSchema
  .partial()
  .refine(
    (event) => {
      if (!event.startsAt || !event.endsAt) {
        return true;
      }

      return new Date(event.endsAt) > new Date(event.startsAt);
    },
    {
      message: "endsAt must be after startsAt.",
      path: ["endsAt"],
    },
  );
