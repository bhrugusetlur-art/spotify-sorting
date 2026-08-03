# Empty Playlist Pagination Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept Spotify's valid zero-limit terminal page for a new empty playlist so a sorting retry can reuse the five existing playlists and add all classified tracks.

**Architecture:** Keep the Spotify response value intact and widen only the shared page-envelope limit boundary from `1..50` to `0..50`. Existing pagination invariants continue to reject oversized pages, repeated offsets, and zero-progress responses that claim more data.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, Next.js 16, pnpm 10

## Global Constraints

- A page limit must be an integer from 0 through 50.
- A zero-limit response is valid only when the existing pagination checks can terminate safely.
- Do not change authentication, retry, logging, classification, playlist naming, database mapping, sync-count, or dashboard behavior.
- Preserve all unrelated working-tree changes.
- Do not include internal tool names in branch names, commit messages, or committed content.

---

### Task 1: Accept Spotify's terminal empty-playlist page

**Files:**
- Modify: `src/lib/spotify/web-api.test.ts:41-57`
- Modify: `src/lib/spotify/web-api.test.ts:273-318`
- Modify: `src/lib/spotify/web-api-types.ts:45-55`

**Interfaces:**
- Consumes: `SpotifyWebApi.playlistItems(id: string): Promise<SpotifyPlaylistItem[]>`
- Consumes: the shared page envelope `{ items, limit, offset, total, next }`
- Produces: unchanged `SpotifyWebApi.playlistItems(id: string): Promise<SpotifyPlaylistItem[]>`, now accepting a safe terminal page with `limit: 0`

- [ ] **Step 1: Extend the playlist-items response fixture with an explicit limit**

Change the fixture input and returned envelope in `src/lib/spotify/web-api.test.ts`:

```typescript
function playlistItemsPage(input: {
  items?: unknown[];
  limit?: number;
  offset?: number;
  total?: number;
  next?: string | null;
} = {}) {
  const items = input.items ?? [];
  return {
    href: `${base}/playlists/playlist-1/items`,
    items,
    limit: input.limit ?? 50,
    offset: input.offset ?? 0,
    total: input.total ?? items.length,
    next: input.next ?? null,
  };
}
```

- [ ] **Step 2: Write the failing boundary-contract test**

Add this test inside `describe("SpotifyWebApi pagination and mutations", ...)`:

```typescript
it("accepts a zero-limit terminal empty page while rejecting out-of-range limits", async () => {
  const terminal = client([response(playlistItemsPage({ limit: 0 }))]);
  await expect(terminal.api.playlistItems("playlist-1")).resolves.toEqual([]);
  expect(terminal.fetcher).toHaveBeenCalledOnce();

  for (const limit of [-1, 51]) {
    const invalid = client([response(playlistItemsPage({ limit }))]);
    await expect(invalid.api.playlistItems("playlist-1")).rejects.toMatchObject({ code: "SPOTIFY_RESPONSE_INVALID" });
  }
});
```

- [ ] **Step 3: Run the focused test and verify the regression is red**

Run:

```bash
pnpm vitest run src/lib/spotify/web-api.test.ts -t "accepts a zero-limit terminal empty page"
```

Expected: FAIL because the `limit: 0` response currently throws `SPOTIFY_RESPONSE_INVALID`; the negative and above-maximum cases remain rejected.

- [ ] **Step 4: Implement the minimal page-envelope change**

Change only the limit field in `src/lib/spotify/web-api-types.ts`:

```typescript
const pageShape = {
  limit: z.number().int().nonnegative().max(50),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  next: z.string().nullable(),
};
```

- [ ] **Step 5: Run the focused test and verify it is green**

Run:

```bash
pnpm vitest run src/lib/spotify/web-api.test.ts -t "accepts a zero-limit terminal empty page"
```

Expected: PASS with one test passed and all nonmatching tests skipped.

- [ ] **Step 6: Run the Spotify client test file**

Run:

```bash
pnpm vitest run src/lib/spotify/web-api.test.ts
```

Expected: PASS with no errors or warnings.

- [ ] **Step 7: Run the full repository verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Expected: every command exits 0. PostgreSQL must be available at the configured `DATABASE_URL`, and the Chromium browser tests must complete without failures.

- [ ] **Step 8: Commit the implementation**

Stage only the implementation and regression-test files, inspect the staged diff, and commit:

```bash
git add src/lib/spotify/web-api.test.ts src/lib/spotify/web-api-types.ts
git diff --cached --check
git diff --cached
git commit -m "fix: accept empty spotify playlist pages"
```

- [ ] **Step 9: Review, graph, and release**

Have an independent reviewer inspect the implementation against the design and test evidence. Address any actionable finding with a new failing test before production changes. Then update the existing project graph, confirm the working tree contains only preserved unrelated changes, and push `main`.
