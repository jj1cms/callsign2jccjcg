# Callsign → JCC / JCG Lookup Web App

A PC- and mobile-friendly web app. Enter an amateur radio callsign; the app retrieves
the **prefecture** from the Japanese MIC (総務省) "Radio Station Information Search"
and displays the corresponding **JCC / JCG / ward code**.

## Architecture (why a proxy is required)

The MIC site **(1) rejects non-browser access with HTTP 403** and **(2) does not send
CORS headers**, so static JavaScript hosted on GitHub Pages cannot query it directly.
A **Cloudflare Worker (relay proxy)** sits in between.

```
[Browser] ──(callsign)──▶ [Cloudflare Worker] ──(browser UA)──▶ [MIC Radio Station Search]
 GitHub Pages              validate / CORS / extract            HTML containing prefecture
       ◀──(JSON: name/prefecture)──┘
   ↓ convert to a code via lookup.json (JCC / JCG / ward table) and render
```

- **Frontend**: `docs/` (served by GitHub Pages)
- **Proxy**: `worker/` (Cloudflare Workers)
- **Lookup table**: `docs/lookup.json` (generated from the lists in `build/`)

## Repository layout

| Path | Description |
|---|---|
| `docs/index.html` `app.js` `styles.css` | Frontend |
| `docs/config.js` | Set the Worker URL here after deployment |
| `docs/lookup.json` | JCC (815 cities) / JCG (379 districts) / wards (176) table (auto-generated) |
| `worker/worker.js` `wrangler.toml` | Cloudflare Worker (relay proxy) |
| `build/*.utf8.txt` `build-lookup.ps1` | Source lists and the generator script |
| `build/static-server.ps1` | Local static server for testing |
| `jcc-list.txt` etc. | Original source data (Shift-JIS, JARL reference) |

## Deployment

### 1. Cloudflare Worker (proxy)

```sh
cd worker
# First time only: npm i -g wrangler && wrangler login
# Edit ALLOWED_ORIGINS in wrangler.toml to your GitHub Pages origin, e.g.:
#   ALLOWED_ORIGINS = "https://<username>.github.io"
wrangler deploy
```

Note the resulting URL (e.g. `https://callsign-proxy.<subdomain>.workers.dev`).

### 2. Frontend (GitHub Pages)

1. Set `WORKER_URL` in `docs/config.js` to the URL from step 1.
2. Push the repository to GitHub.
3. In **Settings → Pages**, choose "Deploy from a branch", select branch `main`
   and folder **`/docs`**.
4. After a few minutes the app is live at
   `https://<username>.github.io/<repository>/`.

> `ALLOWED_ORIGINS` in `wrangler.toml` takes an **origin**
> (`https://<username>.github.io`, no path). Re-deploy the Worker after changing it.

## Regenerating the lookup table (lookup.json)

If you update the source lists (`jcc-list.txt`, etc.), convert them from Shift-JIS
to UTF-8 and then rebuild.

```sh
# In Git Bash (first time / on update)
for f in jcc-list jcg-list ku-list shicho-list; do
  iconv -f CP932 -t UTF-8 "$f.txt" > "build/$f.utf8.txt"; done
```

```powershell
# Regenerate docs/lookup.json
powershell -ExecutionPolicy Bypass -File build\build-lookup.ps1
```

> Kumamoto City's 5 wards are **not** present in the original `ku-list.txt`. They are
> injected as a supplement inside `build-lookup.ps1`, so they survive regeneration.

## Local testing

```powershell
powershell -ExecutionPolicy Bypass -File build\static-server.ps1 -Port 8000
# Open http://localhost:8000/
# To exercise the Worker locally, temporarily add http://localhost:8000 to
# ALLOWED_ORIGINS and run `wrangler dev` / `wrangler deploy`.
```

## Security notes (requirement 3)

- **No internal data is exposed**: only a single callsign's result
  (name, prefecture, code) is returned. The MIC raw HTML and the upstream URL are
  never passed to the frontend.
- **Input validation**: the callsign is restricted to `^[A-Za-z0-9/]{3,12}$` on both
  the frontend and the Worker.
- **Origin restriction**: the Worker grants CORS only to origins listed in
  `ALLOWED_ORIGINS`. Requests with no `Origin` (e.g. curl) get HTTP 403.
- **Other headers**: `no-store`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`; the page is marked `noindex`. For rate limiting,
  pair this with Cloudflare's WAF / Rate Limiting rules.

## Data notes

- JCC = 815 cities, JCG = 379 districts (郡), wards = 176 (171 from `ku-list.txt`
  plus Kumamoto City's 5 wards supplied in `build-lookup.ps1`).
- Tokyo's 23 special wards are treated as JCC entries (per the JARL list).
- Prefecture numbers follow the JARL numbering (01 Hokkaido … 47 Okinawa).
