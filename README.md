# Plandit

Plandit is a modern calendar web app for personal planning, shared schedules, invited collaborators, Google Calendar sync, and future home / lock screen widgets.

## Stack

- Next.js `16.2.7`
- React `19.2.7`
- TypeScript `6.0.3`
- Tailwind CSS `4.3.0`
- PostgreSQL `18.4`
- Prisma ORM `7.4.0`
- Auth.js / NextAuth `5.0.0-beta.31`
- pnpm `11.5.2`
- Node.js `24.16.0`

## Getting Started

```bash
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm dev
```

Open `http://localhost:3000`.

## Docker

```bash
docker compose up --build
```

This starts the Next.js app on `http://localhost:3000` and PostgreSQL on port `5432`.

## Product Scope

- Schedule management: calendars, events, attendees, categories, reminders
- Personal schedules: private calendars and events visible only to the owner
- Shared calendars: calendar members, roles, and invite tokens
- Event sharing: public event links for KakaoTalk or copied-link sharing
- Native signup: email/password account fields on `User`
- SNS login: Google, Kakao, Naver OAuth through Auth.js
- Google Calendar sync: provider account plus calendar sync integration model
- Home / lock screen widgets: shared API-ready widget preferences for later Expo/iOS/Android clients

See [docs/PRODUCT_MODEL.md](docs/PRODUCT_MODEL.md) for the personal/shared/public event model.
