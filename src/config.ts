import type { CalendarSource, DateRange } from "./types.js";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCalendarUrl(url: string): string {
  if (url.startsWith("webcal://")) {
    return `https://${url.slice("webcal://".length)}`;
  }

  return url;
}

export function getSources(): CalendarSource[] {
  const parsed = JSON.parse(requiredEnv("CALENDARS_JSON")) as CalendarSource[];

  return parsed
    .filter((source) => {
      if (!source.name || !source.url || !source.privacy) return false;
      return ["full", "busy", "hidden"].includes(source.privacy);
    })
    .map((source) => ({
      ...source,
      url: normalizeCalendarUrl(source.url)
    }));
}

export function getDateRange(): DateRange {
  const now = Date.now();
  const lookbackDays = numberEnv("LOOKBACK_DAYS", 30);
  const lookaheadDays = numberEnv("LOOKAHEAD_DAYS", 365);

  return {
    from: new Date(now - lookbackDays * 24 * 60 * 60 * 1000),
    to: new Date(now + lookaheadDays * 24 * 60 * 60 * 1000)
  };
}

export function getCalendarName(): string {
  return process.env.CALENDAR_NAME || "Merged calendar";
}

export function getCacheTtlMs(): number {
  return numberEnv("CACHE_TTL_MINUTES", 15) * 60 * 1000;
}

export function getPort(): number {
  return Number(process.env.PORT || 3000);
}

export function getHost(): string {
  return process.env.HOST || "0.0.0.0";
}
