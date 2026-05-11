import ical from "node-ical";
import { createHash } from "node:crypto";
import { getDateRange } from "./config.js";
import { fetchIcs } from "./fetchIcs.js";
import type { CalendarEvent, CalendarSource, DateRange } from "./types.js";

function overlapsRange(start: Date, end: Date, range: DateRange): boolean {
  return start <= range.to && end >= range.from;
}

function eventId(source: CalendarSource, event: ical.VEvent, start: Date, end: Date): string {
  const stableInput = [
    source.name,
    event.uid ?? "",
    event.summary ?? "",
    start.toISOString(),
    end.toISOString()
  ].join("|");

  return createHash("sha256").update(stableInput).digest("hex");
}

function expandEvent(
  event: ical.VEvent,
  source: CalendarSource,
  range: DateRange
): CalendarEvent[] {
  if (!(event.start instanceof Date) || !(event.end instanceof Date)) {
    return [];
  }

  const durationMs = event.end.getTime() - event.start.getTime();

  if (!event.rrule) {
    if (!overlapsRange(event.start, event.end, range)) return [];

    return [
      {
        id: eventId(source, event, event.start, event.end),
        sourceName: source.name,
        privacy: source.privacy,
        start: event.start,
        end: event.end,
        summary: event.summary,
        description: event.description,
        location: event.location
      }
    ];
  }

  const exdates = new Set(
    Object.values(event.exdate ?? {})
      .filter((date): date is Date => date instanceof Date)
      .map((date) => date.toISOString().slice(0, 10))
  );

  return event.rrule
    .between(range.from, range.to, true)
    .filter((start) => !exdates.has(start.toISOString().slice(0, 10)))
    .map((start) => {
      const end = new Date(start.getTime() + durationMs);

      return {
        id: eventId(source, event, start, end),
        sourceName: source.name,
        privacy: source.privacy,
        start,
        end,
        summary: event.summary,
        description: event.description,
        location: event.location
      };
    });
}

function blocks(raw: string, component: string): string[] {
  const pattern = new RegExp(`BEGIN:${component}[\\s\\S]*?END:${component}`, "g");
  return raw.match(pattern) ?? [];
}

function parseEvents(raw: string): ical.VEvent[] {
  const timezoneBlocks = blocks(raw, "VTIMEZONE").join("\n");

  return blocks(raw, "VEVENT").flatMap((eventBlock) => {
    const parsed = ical.sync.parseICS(
      ["BEGIN:VCALENDAR", timezoneBlocks, eventBlock, "END:VCALENDAR"].join("\n")
    );

    return Object.values(parsed).filter((entry): entry is ical.VEvent => entry.type === "VEVENT");
  });
}

export async function loadEvents(source: CalendarSource): Promise<CalendarEvent[]> {
  if (source.privacy === "hidden") return [];

  const raw = await fetchIcs(source);
  const range = getDateRange();

  return parseEvents(raw).flatMap((event) => expandEvent(event, source, range));
}
