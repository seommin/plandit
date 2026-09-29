import { z } from "zod";

export const API_KEY_SCOPES = ["events:read", "events:write", "credits:read"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1)
    .transform((scopes) => [...new Set(scopes)]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
