import { randomBytes } from "crypto";

import {
  Body,
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { z } from "zod";

import { prisma } from "@plandit/database/prisma";

import { getUserId, type RequestWithUser } from "../request-user";

const createShareSchema = z.object({
  channel: z.enum(["LINK", "KAKAO", "NAVER", "EMAIL"]).default("LINK"),
  includeDescription: z.boolean().default(true),
  includeLocation: z.boolean().default(true),
  allowGuestRsvp: z.boolean().default(false),
  expiresAt: z.string().datetime().optional(),
});

@Controller()
export class SharesController {
  @Post("events/:eventId/shares")
  async create(
    @Req() request: RequestWithUser,
    @Param("eventId") eventId: string,
    @Body() payload: unknown,
  ) {
    const userId = getUserId(request);
    const parsed = createShareSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid share payload.");
    }

    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        OR: [
          { createdById: userId },
          {
            calendar: {
              members: {
                some: {
                  userId,
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
      throw new NotFoundException("Event not found.");
    }

    const share = await prisma.eventShare.create({
      data: {
        eventId,
        createdById: userId,
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

    const publicUrl = new URL(`/s/${share.slug}`, process.env.WEB_ORIGIN ?? "http://localhost:3000");

    return {
      share,
      url: publicUrl.toString(),
    };
  }

  @Get("shares/:slug")
  async read(@Param("slug") slug: string) {
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
      throw new NotFoundException("Share not found.");
    }

    await prisma.eventShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 } },
    });

    return { share };
  }
}
