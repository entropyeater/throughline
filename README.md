# Throughline — Career Clarity

A guided web app that finds the single direction sitting at the intersection of
the most interests, skills, and resources you already have. You inventory
everything, rate the synergy between each pair, and the app k-means-clusters the
result — turning a scattered list into a unifying "through-line."

It's a descendant of Chuck Owen's *Insight Matrix* (re-implemented as an
[Observable notebook](https://observablehq.com/@zachpino/insight-matrix) by Zach
Pino): score, visualize, and iteratively cluster comparative similarities among
related elements using k-means on n-dimensional Euclidean distance.

## Run locally

A static, front-end-only site that uses ES modules, so it must be served over
HTTP (opening `index.html` from `file://` will not work — module CORS). On
macOS, double-click **`Start Throughline.command`**. Otherwise:

```bash
cd "insight matrix"
python3 -m http.server 8000   # then open http://localhost:8000
```

There are **no build step and no runtime CDN dependencies** — clustering and
rendering are hand-rolled, so the app works offline. The only external request
is to Google Fonts (with system-font fallbacks if it's blocked).

## The flow

1. **Landing** → **01 Inventory** — dump every direction, skill, hobby, and
   resource (the "Hints & Helpers" prompts unstick you). Aim for 15–40.
2. **02 Ratings** — walk the pairs one at a time; score how much each reinforces
   the other (1 Rarely … 5 Almost always), and jot notes as ideas surface.
3. **03 Clustering** — the grid clusters your items into through-lines. Click
   any cell to rate it, select a cluster to focus it and read its notes, and
   see your densest "emerging through-line" summarized up top.

Everything autosaves to your browser; nothing is sent to a server.

### Hidden controls (the ⋯ menu)

The primary experience is one matrix through the guided flow. Behind the **⋯**
menu in the top bar:

- **Matrix settings** — edit the question, the rating scale, and an "additional
  details / notes" field that mirrors into the rating view.
- **Your matrices** — keep several matrices and switch between them.
- **New matrix**, **Import CSV**, **Export CSV**.

CSV import auto-detects an exported adjacency grid vs. a plain element list;
unrated cells stay blank on export and import back as unrated (never a literal
0). Export omits nothing else.

> **Recommend values** uses the Typesafe AI to suggest synergy scores for the
> unrated pairs. It evaluates each pair one at a time against your live question,
> notes, and rating scale, then **fills in the ratings it's confident about** and
> **leaves the rest for you** — any pair with a surprising / non-obvious
> connection, or one the model judged too close to call. Those flagged pairs stay
> unrated, get a violet outline in the grid, and are listed in a "Worth a personal
> look" card. The call is proxied server-side (see Deploying), so the API key
> never reaches the browser.

## Architecture

No framework, no build. Plain ES modules with a single persistence seam.

```
insight matrix/
├── index.html   — static shell + copy; mounts the app
├── style.css    — the Throughline visual system (design tokens up top)
├── app.js       — view/controller: routing, rendering, events, wiring
├── storage.js   — the ONLY persistence boundary (localStorage); seed data
├── model.js     — element/note helpers, pair navigation, load migration (pure)
├── cluster.js   — k-means + display layout (pure)
├── csv.js       — CSV import/export
├── colors.js    — cluster palette + strength→color ramp
├── typesafe.js  — the AI-recommendation seam (the ONLY network boundary)
├── api/
│   └── evaluate.php — server-side proxy that calls Typesafe with the secret key
└── Start Throughline.command — double-click local launcher (macOS)
```

`typesafe.js` is to AI judgments what `storage.js` is to persistence: the one
module that touches the network. The browser POSTs to the same-origin proxy
`api/evaluate.php`, which attaches the API key server-side — so the key is never
shipped to the browser, and the page's `connect-src` stays `'self'`.

**Data model** (one matrix record, persisted as JSON):

```
{ id, name, question, questionNotes,
  elements:  [{ id, description }],        // `id` is the display name
  strengths: (number|null)[N][N],          // symmetric; diagonal = reflexive
                                           // off-diagonal null = UNRATED (≠ 0)
  notes:     { "i:j": string },            // per-pair, canonical key i<=j
  scaleMin, scaleMax, reflexiveValue, kCount, seed, updatedAt }
```

`storage.js` keys are `insight-matrix:index`, `insight-matrix:matrix:<id>`, and
`insight-matrix:active`. **Don't rename them** — that would orphan saved data.
Loads are backward-compatible (missing fields default, the legacy `details` map
migrates to `description`); migration is lazy, so opening a matrix never
rewrites it. All data access goes through `storage.js`; keep `fetch()` out of
`app.js` (a future backend should mirror that seam — see
`FEATURE-sync-and-sharing.md`).

## Deploying

Upload these files to your host (same origin keeps existing localStorage data
visible): `index.html`, `style.css`, `app.js`, `storage.js`, `model.js`,
`cluster.js`, `csv.js`, `colors.js`, `content.js`, `typesafe.js`,
`api/evaluate.php`, and `.htaccess`. The reference folders (`Old Version/`,
`Insight Matrix Project from Claude Design/`) and the `*.md` spec files are not
part of the deployed app. Easiest is to run `./build-deploy.sh`, which stages
exactly this set into `_deploy/`; upload the *contents* of that folder.

### Test / staging deploys

To preview a build on the real server (e.g. to exercise `api/evaluate.php`,
which can't run locally) without disturbing production, deploy the same set into
a **subfolder** of the production directory — e.g. `insights/test/` →
`https://dqe1.com/insights/test/`. The app uses only relative paths, so it runs
unmodified from any subpath; the proxy resolves to `…/test/api/evaluate.php` and
the parent `insights/.htaccess` cascades down. Run `./build-deploy.sh test-out`
and upload its contents into `insights/test/`.

Caveat: `localStorage` is per-*origin*, not per-path, so a same-domain test
subfolder shares saved matrices with production. View the test build in a
**private/incognito window** to get a clean, isolated user state and keep your
real data untouched.

### Typesafe API key (for "Recommend values")

`api/evaluate.php` needs the Typesafe API key at runtime. It is **never** sent to
the browser. Provide it one of two ways:

- **Preferred:** set a `TYPESAFE_API_KEY` environment variable on the host (in
  cPanel, "Setup PHP / environment variables", or your platform's config).
- **Or:** upload `typesafe_key.txt` (one line, the key) to the site root. The
  bundled `.htaccess` blocks it from being served over the web; PHP still reads
  it from disk. (If you go this route, make sure `.htaccess` is in effect.)

The proxy requires PHP with the cURL extension — standard on Apache/cPanel
hosts. On a non-PHP host (e.g. a JS-serverless platform), port the ~30 lines of
`api/evaluate.php` to that runtime and point `ENDPOINT` in `typesafe.js` at it;
the rest of the app is unchanged. Without a working proxy the app runs fine and
"Recommend values" shows a clear error instead of suggestions.

On Apache/cPanel hosts, **uploading `.htaccess` is what makes deploys take effect
immediately** for users: it sets `Cache-Control: no-cache, must-revalidate` on
the HTML/JS/CSS so browsers revalidate on every load (unchanged files reply a
cheap `304`, changed files are re-fetched). Skip it and the host's default
long-cache can leave users running a stale app for days after a deploy. On
non-Apache hosts, set the equivalent no-cache headers in that host's config.

All user data lives in the browser; the only server-side component is the thin
`api/evaluate.php` proxy (it stores nothing — it just forwards a request and
returns the response). The bundled Content-Security-Policy (a `<meta>` in
`index.html`, mirrored by `.htaccess` for Apache) keeps the browser's network
access to same-origin only (plus Google Fonts) — the Typesafe call happens
server-side, so no third-party origin is needed in `connect-src`.

## Credit

Original tool: Chuck Owen. Observable rewrite: Zach Pino. For a tutorial on
using the matrix for design analysis, see Vijay Kumar's *101 Design Methods*,
sections 4.10 and 4.11.
