import { notFound } from "next/navigation";

import { AuthCard } from "@/components/auth-card";
import { readInternalApi } from "@/lib/api-client";

export const dynamic = "force-dynamic";

type SharePageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function SharePage({ params }: SharePageProps) {
  const { slug } = await params;
  const result = await readInternalApi<{
    share: {
      channel: string;
      includeDescription: boolean;
      includeLocation: boolean;
      event: {
        allDay: boolean;
        title: string;
        startsAt: string;
        location: string | null;
        description: string | null;
        calendar: {
          timezone: string;
        };
      };
    };
  }>(`/shares/${slug}`).catch(() => null);

  if (!result) {
    notFound();
  }

  const { share } = result;
  const startsAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full",
    timeStyle: share.event.allDay ? undefined : "short",
    timeZone: share.event.calendar.timezone,
  }).format(new Date(share.event.startsAt));

  return (
    <AuthCard>
      <p className="text-[13px] font-semibold text-primary">공유된 일정</p>
      <h1 className="mt-1 text-2xl font-bold leading-tight">{share.event.title}</h1>
      <p className="mt-3 text-[15px] font-medium text-fg-2">{startsAt}</p>
      {share.includeLocation && share.event.location ? (
        <p className="mt-5 rounded-xl bg-surface-2 p-3 text-[15px]">{share.event.location}</p>
      ) : null}
      {share.includeDescription && share.event.description ? (
        <p className="mt-4 whitespace-pre-wrap text-[15px] leading-6 text-fg-2">{share.event.description}</p>
      ) : null}
    </AuthCard>
  );
}
