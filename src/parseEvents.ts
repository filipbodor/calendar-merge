import ical from "node-ical";
import { getDateRange } from "./config.js";
import { fetchIcs } from "./fetchIcs.js";
import type { CalendarEvent, CalendarSource, DateRange } from "./types.js";

function overlapsRange(start: Date, end: Date, range: DateRange): boolean {
  return start <= range.to && end >= range.from;
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
  const baseId = event.uid ?? `${source.name}-${event.start.toISOString()}-${event.summary ?? "event"}`;

  if (!event.rrule) {
    if (!overlapsRange(event.start, event.end, range)) return [];

    return [
      {
        id: baseId,
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
    .map((start, index) => ({
      id: `${baseId}-${index}-${start.toISOString()}`,
      sourceName: source.name,
      privacy: source.privacy,
      start,
      end: new Date(start.getTime() + durationMs),
      summary: event.summary,
      description: event.description,
      location: event.location
    }));
}

export async function loadEvents(source: CalendarSource): Promise<CalendarEvent[]> {
  if (source.privacy === "hidden") return [];

  const raw = await fetchIcs(source);
  const parsed = ical.sync.parseICS(raw);
  const range = getDateRange();

  return Object.values(parsed).flatMap((entry) => {
    if (entry.type !== "VEVENT") return [];
    return expandEvent(entry, source, range);
  });
}
