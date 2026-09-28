import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Post,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { hash } from "bcryptjs";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";

import { prisma } from "@plandit/database/prisma";
import { DEFAULT_PERSONAL_CALENDAR_NAME } from "@plandit/shared/calendar-defaults";
import { forgotPasswordSchema, registerSchema, resetPasswordSchema } from "@plandit/shared/auth";

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

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  @Post("register")
  @ApiZodBody(registerSchema)
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
