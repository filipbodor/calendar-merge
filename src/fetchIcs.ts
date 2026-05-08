import type { CalendarSource } from "./types.js";

export async function fetchIcs(source: CalendarSource): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "user-agent": "calendar-merge/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Calendar "${source.name}" failed with HTTP ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown fetch error";
    throw new Error(`Calendar "${source.name}" could not be fetched: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}
