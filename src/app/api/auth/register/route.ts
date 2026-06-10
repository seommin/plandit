import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { DEFAULT_PERSONAL_CALENDAR_NAME } from "@/lib/calendar-defaults";
import { prisma } from "@/lib/prisma";

const registerSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export async function POST(request: Request) {
  const payload = await request.json();
  const parsed = registerSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid registration payload." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    return NextResponse.json(
      { error: "This email is already registered." },
      { status: 409 },
    );
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

  return NextResponse.json({ user }, { status: 201 });
}
