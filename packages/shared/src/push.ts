import { z } from "zod";

export const pushProviderSchema = z.enum([
  "NOOP",
  "WEB_PUSH",
  "EXPO",
  "FCM",
  "APNS",
]);

export const pushSubscriptionCreateSchema = z.object({
  provider: pushProviderSchema.default("NOOP"),
  endpoint: z.string().min(1).max(2048),
  externalId: z.string().max(512).optional(),
  deviceName: z.string().max(120).optional(),
  userAgent: z.string().max(512).optional(),
  platform: z.string().max(80).optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export const pushSubscriptionUpdateSchema = z.object({
  enabled: z.boolean(),
});

export const pushMessageSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(240).optional(),
  url: z.string().max(1024).optional(),
});

export type PushProviderName = z.infer<typeof pushProviderSchema>;
export type PushSubscriptionCreateInput = z.infer<
  typeof pushSubscriptionCreateSchema
>;
export type PushMessageInput = z.infer<typeof pushMessageSchema>;
