# calendar-merge

Self-hosted TypeScript/Fastify service that merges ICS feeds. Node.js 22+.
Read README.md for commands and docs/setup.md for configuration and deployment.

- `src/config.ts`: environment configuration and per-merge privacy rules.
- `src/parseEvents.ts`: source parsing, recurrence expansion, and stable event IDs.
- `src/renderCalendar.ts`: ICS output and privacy redaction.
- `src/calendarService.ts`: cache per merged-feed secret.
- `src/app.ts`: injectable HTTP app; `src/server.ts` starts the listener.

Use node-ical's recurrence helper for timezone/DST/exception handling. Preserve
date-only all-day events. Some feeds reuse upstream UIDs: keep individual VEVENT
parsing and source/date-based output identities unless regression tests justify a change.

Privacy modes are `full`, `busy`, and `hidden`. Busy entries must not expose titles,
locations, or descriptions; hidden sources must not be fetched. Treat source URLs
and merged-feed URLs as credentials: keep real values out of agent output, fixtures,
and commits. Tests use synthetic feeds and mocked fetch; never use live calendars.

Validate with `npm run typecheck`, `npm test`, and `npm run build`. For parsing
changes, run tests with `TZ=UTC` and `TZ=Europe/Bratislava` as CI does.
Keep package versions, release tags, and CHANGELOG.md aligned; release validated commits.
