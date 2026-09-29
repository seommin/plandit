import { Body, Controller, Get, Injectable, Patch, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import { prisma } from "@plandit/database/prisma";
import { profileUpdateSchema } from "@plandit/shared/reminders";

import { ApiZodBody, ZodPipe } from "../common/zod";
import { getUserId, type RequestWithUser } from "../request-user";

const profileSelect = { id: true, name: true, email: true, image: true, phone: true, timezone: true, locale: true } as const;

@Injectable()
export class ProfileService {
  get(userId: string) {
    return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: profileSelect });
  }

  update(userId: string, data: z.infer<typeof profileUpdateSchema>) {
    return prisma.user.update({ where: { id: userId }, data, select: profileSelect });
  }
}

@ApiTags("profile")
@Controller("me")
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  async get(@Req() request: RequestWithUser) {
    return { user: await this.profiles.get(getUserId(request)) };
  }

  /** Phone number for SMS/AlimTalk reminders (null removes it). */
  @Patch()
  @ApiZodBody(profileUpdateSchema)
  async update(
    @Req() request: RequestWithUser,
    @Body(new ZodPipe(profileUpdateSchema)) body: z.infer<typeof profileUpdateSchema>,
  ) {
    return { user: await this.profiles.update(getUserId(request), body) };
  }
}
