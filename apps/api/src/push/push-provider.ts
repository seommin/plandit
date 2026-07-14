import type { PushMessageInput, PushProviderName } from "@plandit/shared/push";
import webPush from "web-push";

export type PushTarget = {
  endpoint: string;
  externalId: string | null;
  metadata: unknown;
};

export type PushSendResult = {
  messageId?: string;
};

export interface PushProviderClient {
  readonly name: PushProviderName;
  send(target: PushTarget, message: PushMessageInput): Promise<PushSendResult>;
}

export class NoopPushProvider implements PushProviderClient {
  readonly name = "NOOP" as const;

  async send() {
    return {
      messageId: `noop_${Date.now()}`,
    };
  }
}

class WebPushProvider implements PushProviderClient {
  readonly name = "WEB_PUSH" as const;

  async send(target: PushTarget, message: PushMessageInput) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
    if (!publicKey || !privateKey) throw new Error("VAPID keys are not configured.");

    const metadata = target.metadata as { auth?: string; p256dh?: string } | null;
    if (!metadata?.auth || !metadata.p256dh) throw new Error("Web Push subscription keys are missing.");

    webPush.setVapidDetails(subject, publicKey, privateKey);
    const result = await webPush.sendNotification(
      { endpoint: target.endpoint, keys: { auth: metadata.auth, p256dh: metadata.p256dh } },
      JSON.stringify(message),
    );
    return { messageId: result.headers.location };
  }
}

export function getPushProvider(provider: PushProviderName): PushProviderClient {
  switch (provider) {
    case "NOOP":
      return new NoopPushProvider();
    case "WEB_PUSH":
      return new WebPushProvider();
    case "EXPO":
    case "FCM":
    case "APNS":
      throw new Error(`${provider} push provider is not configured.`);
  }
}
