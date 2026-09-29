export type CalendarRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export type Calendar = {
  id: string;
  workspaceId: string;
  name: string;
  type: "PERSONAL" | "SHARED" | "SUBSCRIBED";
  color: string;
  role: CalendarRole;
  description?: string | null;
  timezone?: string;
  isDefault?: boolean;
};

export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  color: string;
  visibility: "PRIVATE" | "CALENDAR" | "PUBLIC_LINK";
  isImportant: boolean;
  calendar: { id: string; name: string; type: Calendar["type"]; color: string };
};

export type CalendarState = { calendars: Calendar[]; events: CalendarEvent[] };

export type Workspace = { id: string; name: string; type: "PERSONAL" | "TEAM"; role: WorkspaceRole; createdAt: string };

export type Page<T> = { items: T[]; nextCursor: string | null };

export const canWrite = (calendar: Pick<Calendar, "role">) => ["OWNER", "ADMIN", "EDITOR"].includes(calendar.role);
export const canManage = (calendar: Pick<Calendar, "role">) => ["OWNER", "ADMIN"].includes(calendar.role);
export const isWorkspaceAdmin = (workspace: Pick<Workspace, "role"> | null | undefined) =>
  workspace?.role === "OWNER" || workspace?.role === "ADMIN";
