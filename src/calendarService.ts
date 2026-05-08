import { getCacheTtlMs, getSources } from "./config.js";
import { loadEvents } from "./parseEvents.js";
import { buildCalendar } from "./renderCalendar.js";
import type { CacheState } from "./types.js";

let cache: CacheState | undefined;

export function getCacheStatus() {
  return {
    cached: Boolean(cache),
    generatedAt: cache?.generatedAt.toISOString()
  };
}

export async function getMergedCalendar(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.value;
  }

  const sources = getSources();
  const eventGroups = await Promise.all(sources.map((source) => loadEvents(source)));
  const value = buildCalendar(eventGroups.flat());

  cache = {
    value,
    expiresAt: now + getCacheTtlMs(),
    generatedAt: new Date()
  };

  return value;
}
