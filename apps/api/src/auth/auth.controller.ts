import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Post,
} from "@nestjs/common";
import { hash } from "bcryptjs";

import { prisma } from "@plandit/database/prisma";
import { DEFAULT_PERSONAL_CALENDAR_NAME } from "@plandit/shared/calendar-defaults";
import { registerSchema } from "@plandit/shared/auth";

@Controller("auth")
export class AuthController {
  @Post("register")
  async register(@Body() payload: unknown) {
    const parsed = registerSchema.safeParse(payload);

    if (!parsed.success) {
      throw new BadRequestException("Invalid registration payload.");
    }

    const email = parsed.data.email.toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new ConflictException("This email is already registered.");
    }

    const passwordHash = await hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        passwordHash,
        calendars: {
          create: {
            role: "OWNER",
            calendar: {
              create: {
                name: DEFAULT_PERSONAL_CALENDAR_NAME,
                type: "PERSONAL",
                isDefault: true,
              },
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    return { user };
  }
}
