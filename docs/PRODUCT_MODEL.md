# Product Model

Plandit should support two planning modes in one account.

## Calendar Types

- `PERSONAL`: private calendar for schedules that only the owner can see.
- `SHARED`: collaborative calendar with invited members and roles.
- `SUBSCRIBED`: external or read-only calendar feed, such as imported Google Calendar data.

## Event Visibility

- `PRIVATE`: visible only to the creator.
- `CALENDAR`: visible to calendar members according to their calendar role.
- `PUBLIC_LINK`: visible to anyone with a generated share link, subject to expiry or revocation.

## Sharing Direction

Calendar sharing and event sharing are separate concepts.

- Calendar sharing invites people into a calendar and grants a role: owner, admin, editor, or viewer.
- Event sharing creates a lightweight public page for one event.

This lets a user keep a personal calendar private while still sharing a single event through KakaoTalk or a copied link.

## Kakao / Link Share

Kakao sharing should use a generated public event URL backed by `EventShare`.

Recommended flow:

1. User opens an event.
2. User taps `Share`.
3. App creates an `EventShare` row with a short `slug`.
4. App opens Kakao Share or copies the URL.
5. Anyone with the URL can view the event page until it expires or is revoked.

Public event pages should only expose fields allowed by the share options, such as whether to include location or description.
