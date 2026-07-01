# Insight Matrix

A web application port of Chuck Owen's *Insight Matrix* design tool, originally
re-implemented as an [Observable notebook](https://observablehq.com/@zachpino/insight-matrix)
by Zach Pino. Score, visualize, and iteratively cluster comparative similarities
amongst related elements using k-means clustering on n-dimensional Euclidean
distance.

## Run locally

This is a static site, but it uses ES modules — so it must be served over HTTP
(opening `index.html` from `file://` will not work because of module CORS).

```bash
cd "insight matrix"
python3 -m http.server 8000
```

Then open http://localhost:8000.

Or with Node:

```bash
cd "insight matrix"
npx serve .
```

The first run pulls D3 v7 and `ml-kmeans@6` from CDN, so an internet connection
is required.

## What's here

- **Question** — describe what you're trying to understand. Sent to the
  recommendation API along with the elements and scale.
- **Elements** — comma-separated list of items to compare.
- **Scale** — min / max range expected for cell values (defaults 0 – 1).
- **Matrix** — click any cell to edit a strength value; the grid re-clusters
  automatically on each change.
- **Recommend Interaction Values** — calls `api.js`. Currently returns 1 for
  every off-diagonal pair as a placeholder. Replace the function body with a
  `fetch()` to your service to wire it up.
- **Re-Sort Matrix** — picks a new k-means seed and re-clusters.

## Extending the recommendation API

`api.js` exports `recommendInteractionValues({ question, elements, scale })`.
Its current implementation is a stub that returns `{ matrix: number[N][N] }`
filled with `1`. To swap in a real backend, replace the body — the function
signature, return shape, and call sites in `app.js` stay the same.

```js
// api.js — replace stub with something like:
export async function recommendInteractionValues({ question, elements, scale }) {
  const res = await fetch('https://your-service.example.com/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, elements, scale }),
  });
  if (!res.ok) throw new Error(`Recommend failed: ${res.status}`);
  return await res.json(); // { matrix: number[N][N] }
}
```

## File layout

```
insight matrix/
├── README.md
├── index.html       — markup + CDN script imports
├── style.css        — page styles
├── api.js           — stubbed recommendation API
└── app.js           — element parsing, network build, k-means, SVG render
```

## Credit

Original tool: Chuck Owen. Observable rewrite: Zach Pino
(https://observablehq.com/@zachpino/insight-matrix). For a tutorial on using
the matrix for design analysis, see Vijay Kumar's *101 Design Methods*,
sections 4.10 and 4.11.
