import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SharePageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function SharePage({ params }: SharePageProps) {
  const { slug } = await params;

  const share = await prisma.eventShare.findUnique({
    where: { slug },
    include: {
      event: {
        include: {
          calendar: true,
        },
      },
    },
  });

  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt < new Date())) {
    notFound();
  }

  const startsAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full",
    timeStyle: share.event.allDay ? undefined : "short",
    timeZone: share.event.calendar.timezone,
  }).format(share.event.startsAt);

  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-4 py-10">
      <section className="panel w-full max-w-[520px] p-6">
        <p className="mobile-brand-script mb-8 text-center text-[34px] leading-none">
          Plandit
        </p>
        <div className="mb-5 flex items-center justify-between gap-3">
          <span className="rounded-full bg-[#efeee9] px-3 py-1 text-xs font-semibold text-[#34362f]">
            Shared event
          </span>
          <span className="text-xs text-[var(--muted)]">{share.channel}</span>
        </div>
        <h1 className="text-2xl font-semibold leading-tight">{share.event.title}</h1>
        <p className="mt-3 text-sm font-semibold text-[var(--muted)]">{startsAt}</p>
        {share.includeLocation && share.event.location ? (
          <p className="mt-5 rounded-lg border border-[var(--line)] bg-white p-3 text-sm">
            {share.event.location}
          </p>
        ) : null}
        {share.includeDescription && share.event.description ? (
          <p className="mt-4 text-sm leading-6 text-[#34362f]">{share.event.description}</p>
        ) : null}
      </section>
    </main>
  );
}
