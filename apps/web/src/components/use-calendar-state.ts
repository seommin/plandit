"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/client-api";
import type { Calendar, CalendarEvent, CalendarState } from "@/lib/types";

/**
 * Calendars + events for [from, to), refetched when the range changes. Mutations update the local copy right
 * away (setEvents) so the UI never waits for a refetch.
 */
export function useCalendarState(from: Date, to: Date, initial?: CalendarState) {
  const [calendars, setCalendars] = useState<Calendar[]>(initial?.calendars ?? []);
  const [events, setEvents] = useState<CalendarEvent[]>(initial?.events ?? []);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const skipFirst = useRef(Boolean(initial));
  const key = `${from.toISOString()}|${to.toISOString()}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const state = await api<CalendarState>(`/calendar/state?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
      setCalendars(state.calendars);
      setEvents(state.events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "일정을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    void load();
  }, [load]);

  const upsertEvent = useCallback((event: CalendarEvent) => {
    setEvents((current) => (current.some((e) => e.id === event.id) ? current.map((e) => (e.id === event.id ? event : e)) : [...current, event]));
  }, []);
  const removeEvent = useCallback((id: string) => setEvents((current) => current.filter((e) => e.id !== id)), []);

  return { calendars, setCalendars, events, upsertEvent, removeEvent, loading, error, reload: load };
}

const HIDDEN_KEY = "plandit-hidden-calendars";

/** Which calendars are toggled off, remembered per browser. */
export function useHiddenCalendars() {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try {
      setHidden(JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "[]"));
    } catch {
      setHidden([]);
    }
  }, []);
  const toggle = (id: string) =>
    setHidden((current) => {
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      try {
        window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch {
        // not remembered
      }
      return next;
    });
  return { hidden, toggle };
}

const SCOPE_KEY = "plandit-calendar-scope";

/** Which workspace the calendar screen shows ("all" = every workspace), remembered per browser. */
export function useCalendarScope() {
  const [scope, setScopeState] = useState("all");
  useEffect(() => {
    try {
      setScopeState(window.localStorage.getItem(SCOPE_KEY) ?? "all");
    } catch {
      // not remembered
    }
  }, []);
  const setScope = (next: string) => {
    setScopeState(next);
    try {
      window.localStorage.setItem(SCOPE_KEY, next);
    } catch {
      // not remembered
    }
  };
  return { scope, setScope };
}
