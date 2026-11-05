# Changelog

## 0.1.0

Initial tagged release of the self-hosted ICS calendar feed merger.

- Merge multiple calendar feeds into independently addressable read-only outputs.
- Apply full-detail, busy-only, or hidden privacy modes to each source.
- Keep stable event identities and cache each merged feed separately.
- Handle recurring events, exception dates, daylight saving changes, and all-day dates.
- Add offline regression tests, TypeScript checks, and CI on Node 22/24 in two timezones.
- Include the MIT license and project logo.

Requires Node.js 22 or newer. Calendar feed URLs act as bearer credentials; share
them only with intended subscribers.
