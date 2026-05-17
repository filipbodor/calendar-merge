import "dotenv/config";
import type { CalendarMerge, CalendarSource, DateRange } from "./types.js";

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

function normalizeSources(sources: CalendarSource[]): CalendarSource[] {
  return sources
    .filter((source) => {
      if (!source.name || !source.url || !source.privacy) return false;
      return ["full", "busy", "hidden"].includes(source.privacy);
    })
    .map((source) => ({
      ...source,
      url: normalizeCalendarUrl(source.url)
    }));
}

export function getMerges(): CalendarMerge[] {
  const parsed = JSON.parse(requiredEnv("MERGES_JSON")) as CalendarMerge[];

  return parsed
    .filter((merge) => {
      if (!merge.name || !merge.secret || !Array.isArray(merge.calendars)) return false;
      return Number.isFinite(merge.cacheTtlMinutes) && merge.cacheTtlMinutes > 0;
    })
    .map((merge) => ({
      ...merge,
      calendars: normalizeSources(merge.calendars)
    }));
}

export function findMergeBySecret(secret: string): CalendarMerge | undefined {
  return getMerges().find((merge) => merge.secret === secret);
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

export function getMergeCacheTtlMs(merge: CalendarMerge): number {
  return merge.cacheTtlMinutes * 60 * 1000;
}

export function getPort(): number {
  return Number(process.env.PORT || 3000);
}

export function getHost(): string {
  return process.env.HOST || "0.0.0.0";
}
