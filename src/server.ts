import Fastify from "fastify";
import icalGenerator, { ICalCalendarMethod } from "ical-generator";
import ical from "node-ical";

type PrivacyMode = "full" | "busy" | "hidden";

type CalendarSource = {
  name: string;
  url: string;
  privacy: PrivacyMode;
  prefix?: string;
};

type CalendarEvent = {
  id: string;
  sourceName: string;
  privacy: PrivacyMode;
  start: Date;
  end: Date;
  summary?: string;
  description?: string;
  location?: string;
};

type CacheState = {
  value: string;
  expiresAt: number;
  generatedAt: Date;
};

const app = Fastify({
  logger: true
});

let cache: CacheState | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getSources(): CalendarSource[] {
  const parsed = JSON.parse(requiredEnv("CALENDARS_JSON")) as CalendarSource[];

  return parsed.filter((source) => {
    if (!source.name || !source.url || !source.privacy) return false;
    return ["full", "busy", "hidden"].includes(source.privacy);
  });
}

function dateRange() {
  const now = Date.now();
  const lookbackDays = numberEnv("LOOKBACK_DAYS", 30);
  const lookaheadDays = numberEnv("LOOKAHEAD_DAYS", 365);

  return {
    from: new Date(now - lookbackDays * 24 * 60 * 60 * 1000),
    to: new Date(now + lookaheadDays * 24 * 60 * 60 * 1000)
  };
}

function overlapsRange(start: Date, end: Date, from: Date, to: Date): boolean {
  return start <= to && end >= from;
}

async function fetchIcs(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "calendar-merge/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Calendar fetch failed with ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function expandEvent(
  event: ical.VEvent,
  source: CalendarSource,
  from: Date,
  to: Date
): CalendarEvent[] {
  if (!(event.start instanceof Date) || !(event.end instanceof Date)) {
    return [];
  }

  const durationMs = event.end.getTime() - event.start.getTime();
  const baseId = event.uid ?? `${source.name}-${event.start.toISOString()}-${event.summary ?? "event"}`;

  if (!event.rrule) {
    if (!overlapsRange(event.start, event.end, from, to)) return [];

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
    .between(from, to, true)
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

async function loadEvents(source: CalendarSource): Promise<CalendarEvent[]> {
  if (source.privacy === "hidden") return [];

  const raw = await fetchIcs(source.url);
  const parsed = ical.sync.parseICS(raw);
  const { from, to } = dateRange();

  return Object.values(parsed).flatMap((entry) => {
    if (entry.type !== "VEVENT") return [];
    return expandEvent(entry, source, from, to);
  });
}

function visibleSummary(event: CalendarEvent): string {
  if (event.privacy === "busy") return "Busy";

  const title = event.summary?.trim() || "Untitled event";
  return event.sourceName ? `[${event.sourceName}] ${title}` : title;
}

function buildCalendar(events: CalendarEvent[]): string {
  const calendar = icalGenerator({
    name: process.env.CALENDAR_NAME || "Merged calendar",
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

async function mergedCalendar(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.value;
  }

  const sources = getSources();
  const eventGroups = await Promise.all(sources.map((source) => loadEvents(source)));
  const value = buildCalendar(eventGroups.flat());
  const ttlMinutes = numberEnv("CACHE_TTL_MINUTES", 15);

  cache = {
    value,
    expiresAt: now + ttlMinutes * 60 * 1000,
    generatedAt: new Date()
  };

  return value;
}

app.get("/health", async () => ({
  ok: true,
  cached: Boolean(cache),
  generatedAt: cache?.generatedAt.toISOString()
}));

app.get("/:secret.ics", async (request, reply) => {
  const { secret } = request.params as { secret: string };

  if (secret !== requiredEnv("CALENDAR_SECRET")) {
    return reply.code(404).send("Not found");
  }

  const calendar = await mergedCalendar();

  return reply
    .header("content-type", "text/calendar; charset=utf-8")
    .header("cache-control", "private, max-age=300")
    .send(calendar);
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

await app.listen({ port, host });
