import { Body, Controller, Get, Injectable, Patch, Req } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import { prisma } from "@plandit/database/prisma";
import { profileUpdateSchema } from "@plandit/shared/reminders";

import { ErrorCode } from "../common/api-error";
import { ApiErrors } from "../common/swagger";
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

const USER_EXAMPLE = {
  id: "cmum8us8f0000ekyjnxhqh0h4",
  name: "김데모",
  email: "demo@plandit.dev",
  image: null,
  phone: "01000000001",
  timezone: "Asia/Seoul",
  locale: "ko-KR",
};

@ApiTags("내 정보")
@Controller("me")
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  @ApiOperation({ summary: "내 정보" })
  @ApiOkResponse({ example: { user: USER_EXAMPLE } })
  async get(@Req() request: RequestWithUser) {
    return { user: await this.profiles.get(getUserId(request)) };
  }

  /** Phone number for SMS/AlimTalk reminders (null removes it). */
  @Patch()
  @ApiOperation({
    summary: "문자 수신 번호 바꾸기",
    description:
      "문자·알림톡 리마인더를 받을 휴대폰 번호. 하이픈을 빼고 숫자만 저장하고, `null`이면 지운다. 번호가 없으면 유료 채널 발송은 크레딧 차감 없이 `SKIPPED`(NO_PHONE)로 끝나고, 푸시 구독이 있으면 푸시로 대신 알린다. 모의 중계사는 끝자리가 9인 번호를 `INVALID_NUMBER`로 실패시킨다.",
  })
  @ApiZodBody(profileUpdateSchema, { phone: "010-0000-0001" })
  @ApiOkResponse({ example: { user: USER_EXAMPLE } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED)
  async update(
    @Req() request: RequestWithUser,
    @Body(new ZodPipe(profileUpdateSchema)) body: z.infer<typeof profileUpdateSchema>,
  ) {
    return { user: await this.profiles.update(getUserId(request), body) };
  }
}
