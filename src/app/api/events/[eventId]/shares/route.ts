import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const createShareSchema = z.object({
  channel: z.enum(["LINK", "KAKAO", "NAVER", "EMAIL"]).default("LINK"),
  includeDescription: z.boolean().default(true),
  includeLocation: z.boolean().default(true),
  allowGuestRsvp: z.boolean().default(false),
  expiresAt: z.string().datetime().optional(),
});

type ShareRouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function POST(request: Request, context: ShareRouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await context.params;
  const payload = await request.json();
  const parsed = createShareSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid share payload." }, { status: 400 });
  }

  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      OR: [
        { createdById: session.user.id },
        {
          calendar: {
            members: {
              some: {
                userId: session.user.id,
                role: {
                  in: ["OWNER", "ADMIN", "EDITOR"],
                },
              },
            },
          },
        },
      ],
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  const share = await prisma.eventShare.create({
    data: {
      eventId,
      createdById: session.user.id,
      slug: randomBytes(9).toString("base64url"),
      channel: parsed.data.channel,
      includeDescription: parsed.data.includeDescription,
      includeLocation: parsed.data.includeLocation,
      allowGuestRsvp: parsed.data.allowGuestRsvp,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });

  await prisma.event.update({
    where: { id: eventId },
    data: { visibility: "PUBLIC_LINK" },
  });

  const url = new URL(`/s/${share.slug}`, process.env.NEXTAUTH_URL ?? request.url);

  return NextResponse.json({
    share,
    url: url.toString(),
  });
}
