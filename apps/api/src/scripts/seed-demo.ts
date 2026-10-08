import "reflect-metadata";

import { hash } from "bcryptjs";

import { prisma } from "@plandit/database/prisma";
import { DEFAULT_PERSONAL_CALENDAR_NAME } from "@plandit/shared/calendar-defaults";

import { AuditService } from "../audit/audit.service";
import { LedgerService } from "../credit/ledger.service";
import { chunkText } from "../memory/document-text";
import { ensurePersonalWorkspace } from "../workspace/personal-workspace";

/**
 * Demo data for local development and the public demo: two users, a team workspace with credits,
 * and events around the current week. Idempotent — safe to run repeatedly; never deletes anything.
 * Password: DEMO_PASSWORD (see .env.example). Phones use the 010-0000-xxxx test range only.
 */
const PASSWORD = process.env.DEMO_PASSWORD ?? "plandit-demo-1234";
const TEAM_NAME = "Plandit 데모팀";

const USERS = [
  { email: "demo@plandit.dev", name: "김데모", phone: "01000000001" },
  { email: "teammate@plandit.dev", name: "이팀원", phone: "01000000002" },
];

async function upsertUser(user: (typeof USERS)[number]) {
  const passwordHash = await hash(PASSWORD, 12);
  const saved = await prisma.user.upsert({
    where: { email: user.email },
    create: { ...user, passwordHash },
    update: { name: user.name, phone: user.phone, passwordHash },
  });
  const personal = await ensurePersonalWorkspace(saved.id);
  const hasCalendar = await prisma.calendar.count({ where: { workspaceId: personal.id } });
  if (!hasCalendar) {
    await prisma.calendar.create({
      data: {
        workspaceId: personal.id,
        name: DEFAULT_PERSONAL_CALENDAR_NAME,
        type: "PERSONAL",
        isDefault: true,
        members: { create: { userId: saved.id, role: "OWNER" } },
      },
    });
  }
  return saved;
}

const KICKOFF_NOTES = [
  "A사 킥오프 회의록",
  "참석: 김데모, 이팀원, A사 박부장, A사 최과장",
  "",
  "1. 출시 일정",
  "- 정식 출시는 11월 첫째 주로 확정했다.",
  "- 베타는 10월 셋째 주부터 A사 직원 30명이 먼저 써 본다.",
  "",
  "2. 가격",
  "- 연간 계약은 사용자당 월 8,000원으로 제안했다. A사는 다음 주 화요일까지 내부 검토 후 답을 주기로 했다.",
  "",
  "3. 할 일",
  "- 이팀원: 계약서 초안을 금요일까지 A사에 보낸다.",
  "- 김데모: 베타 계정 30개를 다음 주 월요일까지 만든다.",
  "- A사 최과장: 사내 보안 검토 서류를 보내 준다.",
].join("\n");

function at(dayOffset: number, hour: number, minute = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute);
  return date;
}

async function main() {
  const [owner, teammate] = await Promise.all(USERS.map(upsertUser));

  let team = await prisma.workspace.findFirst({ where: { name: TEAM_NAME, members: { some: { userId: owner.id, role: "OWNER" } } } });
  if (!team) {
    team = await prisma.workspace.create({
      data: {
        name: TEAM_NAME,
        type: "TEAM",
        members: { create: [{ userId: owner.id, role: "OWNER" }, { userId: teammate.id, role: "MEMBER" }] },
        creditAccount: { create: {} },
      },
    });
    await new AuditService().record({
      action: "workspace.created",
      workspaceId: team.id,
      actorId: owner.id,
      targetType: "workspace",
      targetId: team.id,
      payload: { name: TEAM_NAME, source: "seed-demo" },
    });
  }

  let teamCalendar = await prisma.calendar.findFirst({ where: { workspaceId: team.id, name: "팀 일정" } });
  if (!teamCalendar) {
    teamCalendar = await prisma.calendar.create({
      data: {
        workspaceId: team.id,
        name: "팀 일정",
        type: "SHARED",
        color: "#4A6FC4",
        members: { create: [{ userId: owner.id, role: "OWNER" }, { userId: teammate.id, role: "EDITOR" }] },
      },
    });
  }

  const account = await prisma.creditAccount.findUniqueOrThrow({ where: { workspaceId: team.id } });
  await new LedgerService().append({
    accountId: account.id,
    type: "CHARGE",
    amount: 300,
    refType: "MANUAL",
    refId: "seed-demo",
    idempotencyKey: `DEMO:${team.id}:CHARGE`,
    memo: "데모 초기 크레딧",
  });

  const personalCalendar = await prisma.calendar.findFirstOrThrow({
    where: { workspace: { personalOwnerId: owner.id }, isDefault: true },
  });
  const seeded = await prisma.event.count({ where: { calendarId: { in: [personalCalendar.id, teamCalendar.id] } } });
  if (!seeded) {
    const events = [
      { calendarId: teamCalendar.id, title: "주간 팀 회의", startsAt: at(0, 10), endsAt: at(0, 11), location: "3층 회의실" },
      { calendarId: personalCalendar.id, title: "치과 예약", startsAt: at(0, 18, 30), endsAt: at(0, 19, 30), location: "강남역 치과" },
      { calendarId: teamCalendar.id, title: "고객사 A 미팅", startsAt: at(1, 14), endsAt: at(1, 15, 30), location: "A사 본사" },
      { calendarId: personalCalendar.id, title: "헬스", startsAt: at(1, 7), endsAt: at(1, 8) },
      { calendarId: teamCalendar.id, title: "스프린트 계획", startsAt: at(2, 9, 30), endsAt: at(2, 11) },
      { calendarId: teamCalendar.id, title: "제주 워크숍", startsAt: at(4, 0), endsAt: at(6, 0), allDay: true, location: "제주" },
      { calendarId: personalCalendar.id, title: "엄마 생신", startsAt: at(8, 0), endsAt: at(9, 0), allDay: true },
      { calendarId: teamCalendar.id, title: "분기 리뷰", startsAt: at(10, 16), endsAt: at(10, 17, 30) },
      { calendarId: personalCalendar.id, title: "책 모임", startsAt: at(-2, 19), endsAt: at(-2, 21), location: "합정" },
      { calendarId: teamCalendar.id, title: "릴리즈 회고", startsAt: at(-3, 15), endsAt: at(-3, 16) },
    ];
    for (const event of events) {
      await prisma.event.create({
        data: {
          ...event,
          createdById: owner.id,
          visibility: event.calendarId === teamCalendar.id ? "CALENDAR" : "PRIVATE",
        },
      });
    }
  }

  // A past meeting with notes, so "A사랑 출시 언제로 정했지?" has something to find (PLANDIT-22). The worker embeds it.
  const kickoffTitle = "A사 킥오프 미팅";
  const kickoff =
    (await prisma.event.findFirst({ where: { calendarId: teamCalendar.id, title: kickoffTitle } })) ??
    (await prisma.event.create({
      data: { calendarId: teamCalendar.id, title: kickoffTitle, startsAt: at(-7, 14), endsAt: at(-7, 15), location: "A사 본사", createdById: owner.id, visibility: "CALENDAR" },
    }));
  if (!(await prisma.document.count({ where: { eventId: kickoff.id } }))) {
    await prisma.document.create({
      data: {
        eventId: kickoff.id,
        uploadedById: owner.id,
        filename: "A사 킥오프 회의록.txt",
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(KICKOFF_NOTES),
        charCount: KICKOFF_NOTES.length,
        chunks: { create: chunkText(KICKOFF_NOTES).map((content, seq) => ({ seq, content })) },
      },
    });
  }

  console.log(`Demo ready: ${USERS.map((u) => u.email).join(", ")} / password from DEMO_PASSWORD. Team: ${TEAM_NAME}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
