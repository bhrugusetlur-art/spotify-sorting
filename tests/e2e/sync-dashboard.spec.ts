import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { establishMockCallbackSession, establishMockCallbackSessionWithUser } from "./support/mock-callback-session";

const successfulResult = {
  run: {
    id: "run-1",
    status: "succeeded",
    counts: { total: 12, classified: 10, added: 8, skipped: 1, failed: 2 },
    failure: null,
    startedAt: "2026-08-03T12:00:00.000Z",
    completedAt: "2026-08-03T12:00:02.000Z",
  },
  playlists: ["chill", "hype", "focus", "sad", "happy"].map((mood) => ({
    mood,
    name: `Mood Sorter — ${mood}`,
    spotifyPlaylistId: `playlist${mood}`,
    url: `https://open.spotify.com/playlist/playlist${mood}`,
  })),
};

test("an authenticated dashboard announces pending work and renders its successful sync", async ({ context, page }) => {
  const cleanup = await establishMockCallbackSession(context, { displayName: "Ada" });
  let releaseResponse!: () => void;
  let signalRequestHeld!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const requestHeld = new Promise<void>((resolve) => { signalRequestHeld = resolve; });
  await page.route("**/api/sync", async (route) => {
    signalRequestHeld();
    await responseGate;
    await route.fulfill({ json: successfulResult });
  });

  try {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sort My Music" }).click();
    await requestHeld;
    await expect(page.getByRole("button", { name: "Sorting music…" })).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText(/sorting your music/i);

    releaseResponse();

    await expect(page.getByRole("status")).toHaveText(/sorting complete/i);
    await expect(page.getByText("Total: 12")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Spotify" })).toHaveCount(5);
  } finally {
    await cleanup();
  }
});

test("a safe failed sync keeps prior links and can be retried", async ({ context, page }) => {
  const cleanup = await establishMockCallbackSession(context, { displayName: "Ada" });
  let requests = 0;
  await page.route("**/api/sync", async (route) => {
    requests += 1;
    if (requests === 2) {
      await route.fulfill({
        status: 502,
        json: {
          error: { code: "SPOTIFY_UNAVAILABLE", message: "Spotify could not complete the sorting request. Please try again." },
          ...successfulResult,
          run: { ...successfulResult.run, status: "failed", failure: { code: "SPOTIFY_UNAVAILABLE", message: "Spotify could not complete the sorting request. Please try again." } },
          playlists: successfulResult.playlists.slice(0, 1),
        },
      });
      return;
    }
    await route.fulfill({ json: successfulResult });
  });

  try {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sort My Music" }).click();
    await expect(page.getByRole("status")).toHaveText(/sorting complete/i);
    await expect(page.getByRole("link", { name: "Open in Spotify" })).toHaveCount(5);

    await page.getByRole("button", { name: "Sort My Music" }).click();
    await expect(page.getByRole("status")).toHaveText(/spotify could not complete/i);
    await expect(page.getByRole("link", { name: "Open in Spotify" })).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Retry sorting" })).toBeEnabled();
    await page.getByRole("button", { name: "Retry sorting" }).click();
    await expect(page.getByRole("status")).toHaveText(/sorting complete/i);
    expect(requests).toBe(3);
  } finally {
    await cleanup();
  }
});

test("a page reload renders the latest persisted result", async ({ context, page }) => {
  const { cleanup, userId } = await establishMockCallbackSessionWithUser(context, { displayName: "Ada" });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E database configuration is required");
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    await sql`
      insert into sync_runs
        (user_id, status, total_count, classified_count, added_count, skipped_count, failed_count, started_at, completed_at)
      values
        (${userId}, 'succeeded', 12, 10, 8, 1, 2, ${new Date("2026-08-03T12:00:00.000Z")}, ${new Date("2026-08-03T12:00:02.000Z")})
    `;
    for (const playlist of successfulResult.playlists) {
      await sql`
        insert into generated_playlists (user_id, mood, spotify_playlist_id, playlist_name)
        values (${userId}, ${playlist.mood}, ${playlist.spotifyPlaylistId}, ${playlist.name})
      `;
    }

    await page.goto("/dashboard");
    await expect(page.getByText("Total: 12")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Spotify" })).toHaveCount(5);

    await page.reload();
    await expect(page.getByText("Total: 12")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Spotify" })).toHaveCount(5);
  } finally {
    await sql.end({ timeout: 5 });
    await cleanup();
  }
});
