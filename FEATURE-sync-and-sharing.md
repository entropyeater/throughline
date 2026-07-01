# Feature plan — Server-side save, multi-device sync & sharing

> **How to use this file:** This is a working spec. Add your decisions inline
> under each **Decision** (replace `→ _your call:_`), answer the **Open
> questions**, and edit anything you disagree with. The bottom **Instructions
> for next session** block is what Claude will execute — keep it in sync.

---

## Context

- Today the app is a **static, front-end-only site**. All data lives in the
  browser's `localStorage` (`insight-matrix:index` + `insight-matrix:matrix:<id>`
  via `storage.js`). There is **no backend, no accounts, no network calls**
  except CDN script loads and the stubbed `api.js`.
- Consequence: data is trapped on one browser profile. No multi-device access,
  no sharing, no recovery if the cache is cleared.
- This feature is the biggest architectural change the product will take: it
  introduces a server, identity, and a sync model. Treat it as a platform
  decision, not a feature add.

## Proposed solution

Introduce a backend with three capabilities, layered so each is independently
shippable:

1. **Accounts + cloud save (foundation).** A user signs in; their matrices are
   stored server-side keyed to their account. `localStorage` becomes a cache /
   offline buffer, not the source of truth.
2. **Multi-device sync.** Same account on another device loads the same
   matrices. Start with **last-write-wins per matrix** (simple, good enough for
   a single-user-per-account tool); revisit conflict handling only if real-time
   co-editing becomes a goal.
3. **Sharing.** Share a matrix via link with a chosen access level
   (view-only / can-edit). Start with **link-based sharing**; add per-person
   invites later if needed.

### Architecture sketch (keep the front end thin)

- Keep `storage.js` as the **single persistence seam** it already is. Add a
  `remoteStorage.js` (same interface: `listMatrices`, `loadMatrix`, `saveMatrix`,
  `deleteMatrix`) and a small sync layer that reconciles local cache ↔ server.
  Most of `app.js` shouldn't need to know which backend it's talking to.
- The matrix JSON shape (`{id, name, question, elements, strengths, scale…,
  kCount, seed, updatedAt}`) is already serializable — it maps cleanly to a row
  with a JSON blob. `updatedAt` already exists and is the basis for
  last-write-wins.
- Offline-first: write locally first, sync in the background, show sync status.

### Suggested phasing

- **Phase 0 — auth + single-device cloud save.** No sync UI yet; just "your data
  is backed up." Proves out accounts + API.
- **Phase 1 — multi-device read/sync** with last-write-wins + a visible "last
  synced" indicator.
- **Phase 2 — link sharing (view-only).**
- **Phase 3 — shared editing / collaboration** (only if validated; this is where
  conflict resolution gets hard).

---

## Decisions to make

**D1. Build vs. buy the backend.** This is the pivotal call:
- **Backend-as-a-service** (Supabase / Firebase) — fastest to auth + DB + sharing
  rules, minimal server code, vendor lock-in, generous free tiers.
- **Thin custom API** (e.g. small Node/Cloudflare Worker + a DB) — full control,
  more to build and operate.
- **Serverless + managed DB** middle ground.
→ _your call:_

**D2. Identity / sign-in method.** Email magic-link, OAuth (Google/GitHub),
email+password, or passwordless. Affects friction and what onboarding must cover.
→ _your call:_

**D3. Sync model.** Last-write-wins per matrix (recommended start) vs.
field-level merge vs. real-time CRDT collaboration.
→ _your call:_

**D4. Sharing model.** Link with embedded token (anyone with link) vs.
account-gated invites vs. both. View-only first, or edit from day one?
→ _your call:_

**D5. Migration of existing local data.** On first sign-in, do we upload the
user's existing `localStorage` matrices to their new account? (Recommend: yes,
with a clear prompt.)
→ _your call:_

**D6. Pricing / limits.** Free vs. paid tiers? Per-account matrix/storage caps?
This influences DB choice and whether we need billing.
→ _your call:_

**D7. Hosting.** The app is static today (any static host works). A backend
means choosing a host/region and a deploy pipeline.
→ _your call:_

## Open questions (product / design)

1. **Single-user or team product?** "Share with other people" can mean
   read-only link sharing (easy) or true multi-editor collaboration (hard).
   Which is the actual goal, and for v1?
2. **What's the unit of sharing?** A single matrix, or a folder/workspace of
   matrices? Does a shared matrix become a copy or a live link?
3. **Permissions granularity?** Just view/edit, or also comment, or
   owner/admin/member roles?
4. **What happens to the recommendation API?** `api.js` is a stub. If Recommend
   becomes a real (likely paid, LLM-backed) server call, it belongs on the same
   backend with the same auth — worth designing them together. _[If this becomes
   an LLM/Claude-backed endpoint, read the `claude-api` skill before
   implementing.]_
5. **Anonymous use still allowed?** Can people use the tool without an account
   (local-only), then sign in later to back up? (Recommend: yes — keeps the
   no-friction entry point.)
6. **Sharing & the seeded example.** Does the seeded demo matrix or any seeded data
   get synced/shared? It probably shouldn't.

## Considerations & risks

- **Privacy & data ownership.** Matrices may contain personal/sensitive content
  (matrices can hold career or personal data about real people). Server
  storage raises real obligations: privacy policy, deletion/export, and being
  careful with shared links. Decide the data-handling stance before storing
  anyone's data server-side.
- **Security.** Auth, authorization on every read/write (a user must only access
  their own or shared matrices), share-link tokens that can't be guessed or
  enumerated, and revocation. Plan a security review.
- **Cost & ops.** A backend means uptime, backups, monitoring, and a bill —
  ongoing responsibilities the static site doesn't have.
- **Conflict handling.** Last-write-wins can silently lose edits if the same
  matrix is open on two devices. Acceptable for v1 single-user; surface a "this
  was updated elsewhere" warning if cheap.
- **Offline & sync UX.** Users expect local edits not to vanish. Write-local-
  first + background sync + clear status avoids data-loss panic.
- **Keep the seam clean.** The big win is that `storage.js` is already the only
  persistence boundary. Resist scattering `fetch()` calls through `app.js`;
  route everything through the storage interface so local-only mode still works.
- **Scope discipline.** Real-time collaboration (Phase 3) is an order of
  magnitude harder than link sharing. Don't let it creep into v1.

## Touch points in the codebase (for reference)

- `storage.js` — the persistence interface to mirror/extend; `saveMatrix`
  already stamps `updatedAt`, the hook for sync reconciliation.
- `app.js` — calls `listMatrices/loadMatrix/saveMatrix/deleteMatrix`; add
  sign-in state, sync status UI, and share controls without coupling to a
  specific backend.
- `api.js` — the existing (stub) network seam; the new backend may absorb it.
- `index.html` / `style.css` — auth entry point, sync indicator, share dialog.

---

## Instructions for next session

> _Edit this block to match your decisions above. This is the part Claude will
> act on. Until D1/D2 are decided, the safe first step is design, not build._

1. **Before writing backend code:** confirm D1 (build vs. buy) and D2 (sign-in
   method). _[TODO: fill these in — Claude should pause and ask if blank.]_
2. Produce a concrete **Phase 0** technical design: chosen backend, data schema
   (account → matrices JSON), API endpoints (or BaaS tables + rules), and the
   `remoteStorage.js` interface that mirrors `storage.js`.
3. Implement Phase 0 (auth + single-device cloud save) behind the existing
   storage seam, keeping **local-only / anonymous mode working** as a fallback.
4. Include a one-time **migrate-my-local-matrices** prompt on first sign-in
   (D5) — _[TODO: confirm yes]_.
5. Defer sync (Phase 1), sharing (Phase 2), and collaboration (Phase 3) to
   follow-up sessions — _[TODO: confirm or re-order]_.
6. Plan a security review before any shared-link feature ships.
