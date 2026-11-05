import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, mock, test } from "node:test";
import ical, { type VEvent } from "node-ical";
import { buildApp } from "../src/app.js";
import { getCacheStatus, getMergedCalendar } from "../src/calendarService.js";
import {
  findMergeBySecret,
  getDateRange,
  getMerges,
  numberEnv,
  requiredEnv
} from "../src/config.js";
import { fetchIcs } from "../src/fetchIcs.js";
import { loadEvents } from "../src/parseEvents.js";
import { buildCalendar } from "../src/renderCalendar.js";
import type { CalendarEvent, CalendarMerge, CalendarSource } from "../src/types.js";

const now = Date.UTC(2026, 10, 5, 12);
const envKeys = ["MERGES_JSON", "LOOKBACK_DAYS", "LOOKAHEAD_DAYS", "PORT", "HOST"];
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  process.env.MERGES_JSON = "[]";
  mock.method(Date, "now", () => now);
  mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request: tests must use fixture feeds");
  });
});

afterEach(() => {
  mock.restoreAll();
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function source(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return { name: "Work", url: "https://work.invalid/feed.ics", privacy: "full", ...overrides };
}

function merge(overrides: Partial<CalendarMerge> = {}): CalendarMerge {
  return {
    name: "Merged calendar",
    secret: randomUUID(),
    cacheTtlMinutes: 1,
    calendars: [source()],
    ...overrides
  };
}

function event(lines: string[] = []): string {
  return [
    "BEGIN:VEVENT",
    "UID:shared-source-id",
    "DTSTART:20261105T130000Z",
    "DTEND:20261105T140000Z",
    "SUMMARY:Private meeting",
    "LOCATION:Secret office",
    "DESCRIPTION:Confidential notes",
    ...lines,
    "END:VEVENT"
  ].join("\r\n");
}

function calendar(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test fixtures//EN",
    ...events,
    "END:VCALENDAR"
  ].join("\r\n");
}

function renderedEvents(raw: string): VEvent[] {
  return Object.values(ical.sync.parseICS(raw)).filter(
    (entry): entry is VEvent => entry?.type === "VEVENT"
  );
}

test("configuration normalizes webcal feeds, filters invalid entries, and finds exact secrets", () => {
  const valid = merge({
    secret: "exact-test-secret",
    calendars: [
      source({ url: "webcal://work.invalid/feed.ics" }),
      source({ privacy: "hidden" }),
      source({ privacy: "unsupported" as CalendarSource["privacy"] })
    ]
  });
  process.env.MERGES_JSON = JSON.stringify([valid, merge({ cacheTtlMinutes: 0 })]);
  assert.deepEqual(getMerges(), [
    {
      ...valid,
      calendars: [source({ url: "https://work.invalid/feed.ics" }), source({ privacy: "hidden" })]
    }
  ]);
  assert.equal(findMergeBySecret("exact-test-secret")?.name, valid.name);
  assert.equal(findMergeBySecret("exact-test-secre"), undefined);
  assert.equal(findMergeBySecret("EXACT-TEST-SECRET"), undefined);
});

test("configuration rejects missing or malformed merges instead of silently serving a calendar", () => {
  delete process.env.MERGES_JSON;
  assert.throws(() => requiredEnv("MERGES_JSON"), /Missing required/);
  process.env.MERGES_JSON = "not JSON";
  assert.throws(() => getMerges(), SyntaxError);
});

test("date range uses valid overrides and falls back for invalid or non-positive numbers", () => {
  assert.equal(numberEnv("LOOKBACK_DAYS", 30), 30);
  for (const value of ["0", "-2", "NaN", "Infinity"]) {
    process.env.LOOKBACK_DAYS = value;
    assert.equal(numberEnv("LOOKBACK_DAYS", 30), 30);
  }
  process.env.LOOKBACK_DAYS = "2";
  process.env.LOOKAHEAD_DAYS = "7";
  assert.deepEqual(getDateRange(), {
    from: new Date(now - 2 * 86_400_000),
    to: new Date(now + 7 * 86_400_000)
  });
});

test("fetches ICS using a cancellable request and identifies HTTP/network failures", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(calendar(event())));
  assert.equal(await fetchIcs(source()), calendar(event()));
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, source().url);
  assert.ok(options?.signal instanceof AbortSignal);
  assert.equal((options?.headers as Record<string, string>)["user-agent"], "calendar-merge/0.1");
  mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(fetchIcs(source()), /Work.*HTTP 503/);
  mock.method(globalThis, "fetch", async () => {
    throw new Error("connection failed");
  });
  await assert.rejects(fetchIcs(source()), /Work.*connection failed/);
});

test("hidden sources are skipped without fetching them", async () => {
  assert.deepEqual(await loadEvents(source({ privacy: "hidden" })), []);
  assert.equal(mock.method(globalThis, "fetch").mock.callCount(), 0);
});

test("loads overlapping events and excludes events outside the requested date window", async () => {
  const inside = event();
  const past = event().replaceAll("20261105", "20200101");
  const future = event().replaceAll("20261105", "20300101");
  const spanning = event().replace("20261105T130000Z", "20260901T130000Z");
  mock.method(
    globalThis,
    "fetch",
    async () => new Response(calendar(inside, past, future, spanning))
  );
  const events = await loadEvents(source());
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((entry) => entry.start.toISOString()),
    ["2026-11-05T13:00:00.000Z", "2026-09-01T13:00:00.000Z"]
  );
  assert.equal(events[0].summary, "Private meeting");
  assert.equal(events[0].privacy, "full");
});

test("recurrences expand into separate occurrences and respect exception dates", async () => {
  const recurring = event(["RRULE:FREQ=DAILY;COUNT=3", "EXDATE:20261106T130000Z"]);
  mock.method(globalThis, "fetch", async () => new Response(calendar(recurring)));
  const events = await loadEvents(source());
  assert.deepEqual(
    events.map((entry) => [entry.start.toISOString(), entry.end.toISOString()]),
    [
      ["2026-11-05T13:00:00.000Z", "2026-11-05T14:00:00.000Z"],
      ["2026-11-07T13:00:00.000Z", "2026-11-07T14:00:00.000Z"]
    ]
  );
  assert.equal(new Set(events.map((entry) => entry.id)).size, 2);
});

test("localized ICS text parameters render as text rather than objects", async () => {
  const localized = event()
    .replace("SUMMARY:Private meeting", "SUMMARY;LANGUAGE=en:Private meeting")
    .replace("DESCRIPTION:Confidential notes", "DESCRIPTION;LANGUAGE=en:Confidential notes")
    .replace("LOCATION:Secret office", "LOCATION;LANGUAGE=en:Secret office");
  mock.method(globalThis, "fetch", async () => new Response(calendar(localized)));
  const events = await loadEvents(source());
  assert.equal(events[0].summary, "Private meeting");
  assert.equal(events[0].description, "Confidential notes");
  assert.equal(events[0].location, "Secret office");
  const rendered = renderedEvents(buildCalendar("Localized", events));
  assert.equal(rendered[0].summary, "[Work] Private meeting");
});

test("events sharing an upstream UID stay distinct and retain stable output identities", async () => {
  const raw = calendar(event(), event().replaceAll("20261105", "20261106"));
  mock.method(globalThis, "fetch", async () => new Response(raw));
  const first = await loadEvents(source());
  assert.equal(first.length, 2);
  assert.equal(new Set(first.map((entry) => entry.id)).size, 2);
  assert.deepEqual(
    (await loadEvents(source())).map((entry) => entry.id),
    first.map((entry) => entry.id)
  );
  const otherSource = await loadEvents(source({ name: "Personal" }));
  assert.notEqual(otherSource[0].id, first[0].id);
});

test("timezone-based recurrences preserve local meeting times across daylight saving changes", async () => {
  process.env.LOOKBACK_DAYS = "365";
  const recurring = event(["RRULE:FREQ=DAILY;COUNT=3"])
    .replace("DTSTART:20261105T130000Z", "DTSTART;TZID=Europe/Bratislava:20260328T090000")
    .replace("DTEND:20261105T140000Z", "DTEND;TZID=Europe/Bratislava:20260328T100000");
  mock.method(globalThis, "fetch", async () => new Response(calendar(recurring)));
  const events = await loadEvents(source());
  assert.deepEqual(
    events.map((entry) => entry.start.toISOString()),
    ["2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z", "2026-03-30T07:00:00.000Z"]
  );
  assert.ok(events.every((entry) => entry.end.getTime() - entry.start.getTime() === 3_600_000));
});

test("all-day source events retain their calendar date", async () => {
  const allDay = event()
    .replace("DTSTART:20261105T130000Z", "DTSTART;VALUE=DATE:20261105")
    .replace("DTEND:20261105T140000Z", "DTEND;VALUE=DATE:20261106");
  mock.method(globalThis, "fetch", async () => new Response(calendar(allDay)));
  const events = await loadEvents(source());
  assert.equal(events.length, 1);
  assert.equal(events[0].start.toISOString().slice(0, 10), "2026-11-05");
  assert.equal(events[0].end.toISOString().slice(0, 10), "2026-11-06");
  assert.equal(events[0].allDay, true);
  const rendered = buildCalendar("All-day", events);
  assert.match(rendered, /DTSTART;VALUE=DATE:20261105/);
  assert.match(rendered, /DTEND;VALUE=DATE:20261106/);
});

test("an exception for one hourly occurrence does not remove the rest of that day", async () => {
  const hourly = event(["RRULE:FREQ=HOURLY;COUNT=3", "EXDATE:20261105T140000Z"]);
  mock.method(globalThis, "fetch", async () => new Response(calendar(hourly)));
  const events = await loadEvents(source());
  assert.deepEqual(
    events.map((entry) => entry.start.toISOString()),
    ["2026-11-05T13:00:00.000Z", "2026-11-05T15:00:00.000Z"]
  );
});

test("recurring all-day events keep their date and one-day duration across DST", async () => {
  process.env.LOOKBACK_DAYS = "365";
  const recurring = event(["RRULE:FREQ=DAILY;COUNT=3"])
    .replace("DTSTART:20261105T130000Z", "DTSTART;VALUE=DATE:20260328")
    .replace("DTEND:20261105T140000Z", "DTEND;VALUE=DATE:20260329");
  mock.method(globalThis, "fetch", async () => new Response(calendar(recurring)));
  const events = await loadEvents(source());
  assert.deepEqual(
    events.map((entry) => [entry.start.toISOString(), entry.end.toISOString()]),
    [
      ["2026-03-28T00:00:00.000Z", "2026-03-29T00:00:00.000Z"],
      ["2026-03-29T00:00:00.000Z", "2026-03-30T00:00:00.000Z"],
      ["2026-03-30T00:00:00.000Z", "2026-03-31T00:00:00.000Z"]
    ]
  );
  assert.ok(events.every((entry) => entry.allDay));
});

test("rendered calendars keep full details, redact busy entries, and sort events", () => {
  const full: CalendarEvent = {
    id: "full-id",
    sourceName: "Personal",
    privacy: "full",
    start: new Date("2026-11-05T15:00:00Z"),
    end: new Date("2026-11-05T16:00:00Z"),
    summary: "Dinner",
    location: "Private home",
    description: "Private invitation"
  };
  const busy: CalendarEvent = {
    ...full,
    id: "busy-id",
    sourceName: "Work",
    privacy: "busy",
    start: new Date("2026-11-05T13:00:00Z"),
    end: new Date("2026-11-05T14:00:00Z"),
    summary: "Secret client",
    location: "Secret office",
    description: "Confidential notes"
  };
  const raw = buildCalendar("My calendar", [full, busy]);
  const events = renderedEvents(raw);
  assert.deepEqual(
    events.map((entry) => entry.uid),
    ["busy-id", "full-id"]
  );
  assert.deepEqual(
    events.map((entry) => entry.summary),
    ["Busy", "[Personal] Dinner"]
  );
  assert.equal(events[0].location, undefined);
  assert.equal(events[0].description, undefined);
  assert.equal(events[1].location, "Private home");
  assert.equal(events[1].description, "Private invitation");
  for (const hiddenValue of ["Secret client", "Secret office", "Confidential notes"]) {
    assert.ok(!raw.includes(hiddenValue));
  }
});

test("rendering supports empty feeds and uses a fallback title for untitled events", () => {
  assert.deepEqual(renderedEvents(buildCalendar("Empty", [])), []);
  const raw = buildCalendar("Calendar", [
    {
      id: "untitled",
      sourceName: "",
      privacy: "full",
      start: new Date(now),
      end: new Date(now + 3_600_000),
      summary: "  "
    }
  ]);
  assert.equal(renderedEvents(raw)[0].summary, "Untitled event");
});

test("merge cache is isolated by secret and refreshes only after its TTL", async () => {
  let clock = now;
  mock.method(Date, "now", () => clock);
  let title = "First version";
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response(calendar(event().replace("Private meeting", title)))
  );
  const first = merge();
  const second = merge();
  const original = await getMergedCalendar(first);
  title = "New version";
  assert.equal(await getMergedCalendar(first), original);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.match(await getMergedCalendar(second), /New version/);
  assert.equal(fetchMock.mock.callCount(), 2);
  clock += 60_000;
  assert.match(await getMergedCalendar(first), /New version/);
  assert.equal(fetchMock.mock.callCount(), 3);
});

test("a failed upstream fetch is not cached and the next request can recover", async () => {
  const item = merge();
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () => new Response("error", { status: 502 })
  );
  await assert.rejects(getMergedCalendar(item), /HTTP 502/);
  mock.method(globalThis, "fetch", async () => new Response(calendar(event())));
  assert.equal(renderedEvents(await getMergedCalendar(item)).length, 1);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("HTTP endpoints serve merged ICS, reject unknown secrets, and expose only health counts", async (context) => {
  const full = source({ name: "Personal", url: "https://personal.invalid/feed.ics" });
  const busy = source({ privacy: "busy" });
  const hidden = source({
    name: "Hidden",
    privacy: "hidden",
    url: "https://hidden.invalid/feed.ics"
  });
  const item = merge({ calendars: [full, busy, hidden] });
  process.env.MERGES_JSON = JSON.stringify([item]);
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(calendar(event())));
  const app = buildApp({ logger: false });
  context.after(() => app.close());
  const unknown = await app.inject({ method: "GET", url: "/unknown-secret.ics" });
  assert.equal(unknown.statusCode, 404);
  assert.equal(fetchMock.mock.callCount(), 0);
  const response = await app.inject({ method: "GET", url: `/${item.secret}.ics` });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] as string, /^text\/calendar/);
  assert.equal(response.headers["cache-control"], "private, max-age=300");
  const events = renderedEvents(response.body);
  assert.deepEqual(events.map((entry) => entry.summary).sort(), [
    "Busy",
    "[Personal] Private meeting"
  ]);
  assert.deepEqual(
    fetchMock.mock.calls.map((call) => call.arguments[0]).sort(),
    [full.url, busy.url].sort()
  );
  assert.equal(new Set(events.map((entry) => entry.uid)).size, 2);
  const health = (await app.inject({ method: "GET", url: "/health" })).json();
  assert.deepEqual(Object.keys(health).sort(), ["cached", "merges", "ok"]);
  assert.equal(health.ok, true);
  assert.equal(health.merges, 1);
  assert.equal(typeof health.cached, "number");
  assert.ok(!JSON.stringify(health).includes(item.secret));
  assert.equal((await app.inject({ method: "GET", url: "/" })).body, "calendar-merge ok\n");
  assert.ok(getCacheStatus().cached > 0);
});
