import { getMergeCacheTtlMs, getMerges } from "./config.js";
import { loadEvents } from "./parseEvents.js";
import { buildCalendar } from "./renderCalendar.js";
import type { CacheState, CalendarMerge } from "./types.js";

const cache = new Map<string, CacheState>();

export function getCacheStatus() {
  return {
    merges: getMerges().length,
    cached: cache.size
  };
}

export async function getMergedCalendar(merge: CalendarMerge): Promise<string> {
  const now = Date.now();
  const cached = cache.get(merge.secret);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const eventGroups = await Promise.all(merge.calendars.map((source) => loadEvents(source)));
  const value = buildCalendar(merge.name, eventGroups.flat());

  cache.set(merge.secret, {
    value,
    expiresAt: now + getMergeCacheTtlMs(merge),
    generatedAt: new Date()
  });

  return value;
}
