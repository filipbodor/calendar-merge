<p align="center">
  <img src="assets/logo.png" width="180" alt="calendar-merge logo">
</p>

<h1 align="center">calendar-merge</h1>

A tiny self-hosted calendar feed merger.

It fetches private/public ICS feeds, applies simple privacy rules, and serves merged read-only `.ics` feeds behind long secret URLs.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Then open:

```txt
http://localhost:3000/YOUR_SECRET.ics
```

## Environment

```txt
LOOKBACK_DAYS=30
LOOKAHEAD_DAYS=365
MERGES_JSON=[{"name":"Personal view","secret":"long-random-secret","cacheTtlMinutes":30,"calendars":[{"name":"Work","url":"https://.../basic.ics","privacy":"busy"},{"name":"Personal","url":"https://.../basic.ics","privacy":"full"}]}]
```

Each merge gets its own feed:

```txt
https://calendar.filipbodor.com/long-random-secret.ics
```

Privacy modes:

- `full`: keep title, location, and description
- `busy`: replace title with `Busy`, remove location and description
- `hidden`: skip the calendar

## License

[MIT](LICENSE).

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Tests use synthetic feeds and mocked requests; no calendar credentials or network
access are needed. CI runs on Node.js 22 and 24 in UTC and Europe/Bratislava.
