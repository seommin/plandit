import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Post,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { hash } from "bcryptjs";
import { ApiCreatedResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import { prisma } from "@plandit/database/prisma";
import { DEFAULT_PERSONAL_CALENDAR_NAME } from "@plandit/shared/calendar-defaults";
import { forgotPasswordSchema, registerSchema, resetPasswordSchema } from "@plandit/shared/auth";

import { ErrorCode } from "../common/api-error";
import { ApiErrors } from "../common/swagger";
import { ApiZodBody, ZodPipe } from "../common/zod";
import { ensurePersonalWorkspace } from "../workspace/personal-workspace";

const RESET_TOKEN_PREFIX = "password-reset:";
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function sendPasswordResetEmail(email: string, resetUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM_EMAIL;

  if (!apiKey || !from) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Plandit 비밀번호 재설정",
      html: `<p>아래 링크에서 비밀번호를 재설정해주세요.</p><p><a href="${resetUrl}">비밀번호 재설정</a></p><p>이 링크는 30분 동안 유효합니다.</p>`,
    }),
  });

  return response.ok;
}

const EXAMPLE_RESET_TOKEN = "example-reset-token-from-the-email-link-0000";

@ApiTags("인증")
@Controller("auth")
export class AuthController {
  @Post("register")
  @ApiOperation({
    summary: "이메일 가입",
    description:
      "이메일은 소문자로 바꿔 저장하고 비밀번호는 bcrypt 해시만 남긴다. 사용자·개인 워크스페이스(크레딧 계정 포함)·기본 개인 캘린더를 한 트랜잭션에서 만든다. 이미 가입한 이메일이면 409.",
  })
  @ApiZodBody(registerSchema, { name: "김데모", email: "demo@plandit.dev", password: "demo-password-1234" })
  @ApiCreatedResponse({ example: { user: { id: "cmum8us8f0000ekyjnxhqh0h4", name: "김데모", email: "demo@plandit.dev" } } })
  @ApiErrors(ErrorCode.VALIDATION_FAILED, ErrorCode.CONFLICT)
  async register(@Body(new ZodPipe(registerSchema)) payload: z.infer<typeof registerSchema>) {
    const email = payload.email.toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new ConflictException("This email is already registered.");
    }

    const passwordHash = await hash(payload.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: payload.name, email, passwordHash },
        select: { id: true, name: true, email: true },
      });
      const workspace = await ensurePersonalWorkspace(created.id, tx);
      await tx.calendar.create({
        data: {
          workspaceId: workspace.id,
          name: DEFAULT_PERSONAL_CALENDAR_NAME,
          type: "PERSONAL",
          isDefault: true,
          members: { create: { userId: created.id, role: "OWNER" } },
        },
      });
      return created;
    });

    return { user };
  }

  @Post("forgot-password")
  @ApiOperation({
    summary: "비밀번호 재설정 메일 요청",
    description:
      "가입 여부를 드러내지 않도록 없는 이메일(또는 소셜 로그인만 쓰는 계정)에도 `{ ok: true }`를 준다. 30분 동안 쓸 수 있는 링크를 만들고 이전 링크는 무효로 한다. production이 아니고 메일을 못 보냈으면(RESEND_API_KEY 미설정 등) 응답에 `developmentResetUrl`이 붙는다.",
  })
  @ApiZodBody(forgotPasswordSchema, { email: "demo@plandit.dev" })
  @ApiCreatedResponse({ example: { ok: true, developmentResetUrl: `http://localhost:3000/reset-password?token=${EXAMPLE_RESET_TOKEN}` } })
  @ApiErrors(ErrorCode.BAD_REQUEST)
  async forgotPassword(@Body() payload: unknown) {
    const parsed = forgotPasswordSchema.safeParse(payload);
    if (!parsed.success) throw new BadRequestException("Invalid email address.");

    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
    if (!user?.passwordHash) return { ok: true };

    const token = randomBytes(32).toString("base64url");
    const identifier = `${RESET_TOKEN_PREFIX}${email}`;
    const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await prisma.$transaction([
      prisma.verificationToken.deleteMany({ where: { identifier } }),
      prisma.verificationToken.create({
        data: { identifier, token: hashResetToken(token), expires },
      }),
    ]);

    const resetUrl = new URL(
      `/reset-password?token=${encodeURIComponent(token)}`,
      process.env.WEB_ORIGIN ?? "http://localhost:3000",
    ).toString();
    const emailSent = await sendPasswordResetEmail(email, resetUrl);

    return {
      ok: true,
      ...(process.env.NODE_ENV !== "production" && !emailSent
        ? { developmentResetUrl: resetUrl }
        : {}),
    };
  }

  @Post("reset-password")
  @ApiOperation({
    summary: "비밀번호 재설정",
    description: "메일 링크의 토큰으로 비밀번호를 바꾼다. 토큰은 한 번 쓰면 지워진다. 형식이 틀리거나 없는·만료된 토큰이면 400 BAD_REQUEST.",
  })
  @ApiZodBody(resetPasswordSchema, { token: EXAMPLE_RESET_TOKEN, password: "new-password-5678" })
  @ApiCreatedResponse({ example: { ok: true } })
  @ApiErrors(ErrorCode.BAD_REQUEST)
  async resetPassword(@Body() payload: unknown) {
    const parsed = resetPasswordSchema.safeParse(payload);
    if (!parsed.success) throw new BadRequestException("Invalid password reset payload.");

    const tokenHash = hashResetToken(parsed.data.token);
    const resetToken = await prisma.verificationToken.findUnique({ where: { token: tokenHash } });
    if (!resetToken || !resetToken.identifier.startsWith(RESET_TOKEN_PREFIX) || resetToken.expires < new Date()) {
      throw new BadRequestException("This password reset link is invalid or expired.");
    }

    const email = resetToken.identifier.slice(RESET_TOKEN_PREFIX.length);
    const passwordHash = await hash(parsed.data.password, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { email }, data: { passwordHash } }),
      prisma.verificationToken.deleteMany({ where: { identifier: resetToken.identifier } }),
    ]);

    return { ok: true };
  }
}
