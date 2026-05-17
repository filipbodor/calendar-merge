import icalGenerator, { ICalCalendarMethod } from "ical-generator";
import type { CalendarEvent } from "./types.js";

function visibleSummary(event: CalendarEvent): string {
  if (event.privacy === "busy") return "Busy";

  const title = event.summary?.trim() || "Untitled event";
  return event.sourceName ? `[${event.sourceName}] ${title}` : title;
}

export function buildCalendar(name: string, events: CalendarEvent[]): string {
  const calendar = icalGenerator({
    name,
    prodId: {
      company: "filipbodor.com",
      product: "calendar-merge"
    }
  });

  calendar.method(ICalCalendarMethod.PUBLISH);

  for (const event of events.sort((a, b) => a.start.getTime() - b.start.getTime())) {
    calendar.createEvent({
      id: event.id,
      start: event.start,
      end: event.end,
      summary: visibleSummary(event),
      description: event.privacy === "full" ? event.description : undefined,
      location: event.privacy === "full" ? event.location : undefined
    });
  }

  return calendar.toString();
}
