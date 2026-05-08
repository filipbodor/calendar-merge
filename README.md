# calendar-merge

A tiny self-hosted calendar feed merger.

It fetches multiple private/public ICS feeds, applies simple privacy rules, and serves one merged read-only `.ics` feed behind a long secret URL.

## Run locally

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
CALENDAR_SECRET=long-random-secret
CACHE_TTL_MINUTES=15
CALENDAR_NAME=Filip merged calendar
LOOKBACK_DAYS=30
LOOKAHEAD_DAYS=365
CALENDARS_JSON=[{"name":"Work","url":"https://.../basic.ics","privacy":"busy"}]
```

Privacy modes:

- `full`: keep title, location, and description
- `busy`: replace title with `Busy`, remove location and description
- `hidden`: skip the calendar

## Railway

Use the normal web service start command:

```bash
npm run start
```

Set the same environment variables in Railway. Add `calendar.filipbodor.com` as a Railway custom domain, then create a CNAME in your DNS provider pointing to the Railway target.
