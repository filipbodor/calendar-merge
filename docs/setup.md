# Configuration and deployment

Copy `.env.example` to `.env` locally. In a hosting service, set the same environment
variables there. Real `.env` files and `calendar.json` are Git-ignored.

## Feed configuration

`MERGES_JSON` is a required JSON array. Each item defines a merged output:

| Field | Meaning |
| --- | --- |
| `name` | Name shown by calendar clients |
| `secret` | Unique, long random string used in the output URL |
| `cacheTtlMinutes` | Positive cache duration in minutes |
| `calendars` | Source calendars, each with `name`, `url`, and `privacy` |

Use `full` to include source details, `busy` to replace the title with “Busy” and
remove location/description, or `hidden` to skip fetching that source.
`webcal://` source URLs are normalized to HTTPS.

Generate a secret locally:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Each merge is served at `https://YOUR_HOST/SECRET.ics`. Anyone with that complete
URL can read the feed; it is not protected by a separate login.

Optional environment variables: `LOOKBACK_DAYS` (default 30), `LOOKAHEAD_DAYS`
(365), `HOST` (`0.0.0.0`), and `PORT` (3000). The date window is relative to now.

## Deployment

Use Node.js 22+. Build with `npm ci && npm run build`, then start with `npm start`.
The service uses the host's `PORT` environment variable. `/health` returns status
and cache/merge counts without listing feed URLs or event data.

On Railway, keep **Project Settings → Visibility → Private** to restrict access
to the dashboard and logs. This is independent of the public GitHub repository
and does not disable the HTTP subscription endpoints. Keep logs private: request
logs can contain feed URLs. [Railway project visibility](https://docs.railway.com/projects#project-visibility).
