import ical, { type VEvent } from "node-ical";
import { createHash } from "node:crypto";
import { getDateRange } from "./config.js";
import { fetchIcs } from "./fetchIcs.js";
import type { CalendarEvent, CalendarSource, DateRange } from "./types.js";

function textValue(value: string | { val: string } | undefined): string | undefined {
  return typeof value === "string" ? value : value?.val;
}

function eventId(source: CalendarSource, event: VEvent, start: Date, end: Date): string {
  const stableInput = [
    source.name,
    event.uid ?? "",
    textValue(event.summary) ?? "",
    start.toISOString(),
    end.toISOString()
  ].join("|");

  return createHash("sha256").update(stableInput).digest("hex");
}

function calendarDate(date: Date, timeZone?: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

function expandEvent(event: VEvent, source: CalendarSource, range: DateRange): CalendarEvent[] {
  if (!(event.start instanceof Date) || !(event.end instanceof Date)) return [];

  return ical.expandRecurringEvent(event, { ...range, expandOngoing: true }).map((instance) => {
    // Preserve calendar dates independently of the server's timezone when rendering all-day events.
    const zone = instance.start.tz ?? event.start.tz;
    const start = instance.isFullDay ? calendarDate(instance.start, zone) : instance.start;
    const end = instance.isFullDay ? calendarDate(instance.end, zone) : instance.end;
    return {
      id: eventId(source, instance.event, start, end),
      sourceName: source.name,
      privacy: source.privacy,
      start,
      end,
      allDay: instance.isFullDay,
      summary: textValue(instance.summary),
      description: textValue(instance.event.description),
      location: textValue(instance.event.location)
    };
  });
}

function blocks(raw: string, component: string): string[] {
  const pattern = new RegExp(`BEGIN:${component}[\\s\\S]*?END:${component}`, "g");
  return raw.match(pattern) ?? [];
}

function parseEvents(raw: string): VEvent[] {
  const timezoneBlocks = blocks(raw, "VTIMEZONE").join("\n");

  return blocks(raw, "VEVENT").flatMap((eventBlock) => {
    const parsed = ical.sync.parseICS(
      ["BEGIN:VCALENDAR", timezoneBlocks, eventBlock, "END:VCALENDAR"].join("\n")
    );

    return Object.values(parsed).filter((entry): entry is VEvent => entry?.type === "VEVENT");
  });
}

export async function loadEvents(source: CalendarSource): Promise<CalendarEvent[]> {
  if (source.privacy === "hidden") return [];

  const raw = await fetchIcs(source);
  const range = getDateRange();

  return parseEvents(raw).flatMap((event) => expandEvent(event, source, range));
}
