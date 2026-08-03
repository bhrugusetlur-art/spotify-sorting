import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createDrizzleClassificationRepository } from "@/lib/sync/classification-repository";
import { createDrizzleGeneratedPlaylistRepository } from "@/lib/sync/playlist-repository";
import { createDrizzleSyncRunRepository } from "@/lib/sync/run-repository";
import { closeDb, getDb } from "@/lib/db/client";
import { syncRuns, users } from "@/lib/db/schema";

const createdUsers: string[] = [];
const counts = { total: 10, classified: 8, added: 5, skipped: 3, failed: 0 };

afterEach(async () => {
  const db = getDb();
  await Promise.all(createdUsers.splice(0).map((id) => db.delete(users).where(eq(users.id, id))));
});

afterAll(async () => {
  await closeDb();
});

async function createUser(): Promise<string> {
  const id = randomUUID();
  createdUsers.push(id);
  await getDb().insert(users).values({
    id,
    spotifyAccountId: `sync-repositories-account-${id}`,
    spotifyUserId: `sync-repositories-user-${id}`,
    displayName: "Repository Test",
  });
  return id;
}

describe("Drizzle sorting repositories", () => {
  it("persists and replaces a fingerprinted classification for its version", async () => {
    const userId = await createUser();
    const repository = createDrizzleClassificationRepository();
    await repository.upsert(userId, {
      spotifyTrackId: "track-1",
      mood: "chill",
      classifierVersion: "metadata-v1",
      reason: "Matched calm in title.",
      metadataFingerprint: "fingerprint-1",
    });
    await repository.upsert(userId, {
      spotifyTrackId: "track-1",
      mood: "focus",
      classifierVersion: "metadata-v1",
      reason: "Matched study in title.",
      metadataFingerprint: "fingerprint-2",
    });

    await expect(repository.find(userId, "track-1", "metadata-v1")).resolves.toEqual({
      spotifyTrackId: "track-1",
      mood: "focus",
      classifierVersion: "metadata-v1",
      reason: "Matched study in title.",
      metadataFingerprint: "fingerprint-2",
    });
    await expect(repository.find(userId, "track-1", "metadata-v2")).resolves.toBeNull();
  });

  it("replaces a generated playlist mapping for one user and mood", async () => {
    const userId = await createUser();
    const repository = createDrizzleGeneratedPlaylistRepository();
    const runs = createDrizzleSyncRunRepository();
    const active = await runs.acquire(userId, new Date("2026-08-03T12:00:00.000Z"));
    await repository.upsert({ userId, mood: "chill", spotifyPlaylistId: "playlist-old", playlistName: "Mood Sorter — Chill" }, active);
    await repository.upsert({ userId, mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" }, active);

    await expect(repository.list(userId)).resolves.toEqual([
      { userId, mood: "chill", spotifyPlaylistId: "playlist-new", playlistName: "Mood Sorter — Chill" },
    ]);
  });

  it("fences a stale lease from replacing a newer generated playlist mapping", async () => {
    const userId = await createUser();
    const repository = createDrizzleGeneratedPlaylistRepository();
    const runs = createDrizzleSyncRunRepository();
    const old = await runs.acquire(userId, new Date("2026-08-03T12:00:00.000Z"));
    await repository.upsert({ userId, mood: "chill", spotifyPlaylistId: "playlist-old", playlistName: "Mood Sorter — Chill" }, old);
    const fresh = await runs.acquire(userId, new Date("2026-08-03T12:15:00.000Z"));
    await repository.upsert({ userId, mood: "chill", spotifyPlaylistId: "playlist-fresh", playlistName: "Mood Sorter — Chill" }, fresh);

    await expect(repository.upsert({ userId, mood: "chill", spotifyPlaylistId: "playlist-stale", playlistName: "Mood Sorter — Chill" }, old)).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" });
    await expect(repository.list(userId)).resolves.toEqual([
      { userId, mood: "chill", spotifyPlaylistId: "playlist-fresh", playlistName: "Mood Sorter — Chill" },
    ]);
  });

  it("serializes a blocked mapping write with replacement acquisition", async () => {
    const userId = await createUser();
    const repository = createDrizzleGeneratedPlaylistRepository();
    const runs = createDrizzleSyncRunRepository();
    const old = await runs.acquire(userId, new Date("2026-08-03T12:00:00.000Z"));
    await repository.upsert({ userId, mood: "chill", spotifyPlaylistId: "playlist-original", playlistName: "Mood Sorter — Chill" }, old);
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("integration database is required");
    const locker = postgres(databaseUrl, { prepare: false });
    const probe = postgres(databaseUrl, { prepare: false });
    const locked = deferred<void>();
    const release = deferred<void>();
    const block = locker.begin(async (tx) => {
      await tx`select id from generated_playlists where user_id = ${userId} and mood = 'chill' for update`;
      locked.resolve();
      await release.promise;
    });

    try {
      await locked.promise;
      const stale = repository.upsert({ userId, mood: "chill", spotifyPlaylistId: "playlist-stale", playlistName: "Mood Sorter — Chill" }, old);
      await waitForMappingLock(probe);
      const replacement = runs.acquire(userId, new Date("2026-08-03T12:15:00.000Z"));
      let replacementSettled = false;
      void replacement.then(() => { replacementSettled = true; });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(replacementSettled).toBe(false);

      release.resolve();
      await block;
      await stale;
      const fresh = await replacement;
      await repository.upsert({ userId, mood: "chill", spotifyPlaylistId: "playlist-fresh", playlistName: "Mood Sorter — Chill" }, fresh);
      await expect(repository.list(userId)).resolves.toEqual([
        { userId, mood: "chill", spotifyPlaylistId: "playlist-fresh", playlistName: "Mood Sorter — Chill" },
      ]);
    } finally {
      release.resolve();
      await block.catch(() => undefined);
      await Promise.all([locker.end({ timeout: 5 }), probe.end({ timeout: 5 })]);
    }
  });

  it("allows only one running lease when acquisitions race", async () => {
    const userId = await createUser();
    const repository = createDrizzleSyncRunRepository();
    const now = new Date("2026-08-03T12:00:00.000Z");

    const results = await Promise.allSettled([repository.acquire(userId, now), repository.acquire(userId, now)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "SYNC_ALREADY_RUNNING" }) }),
    ]);
  });

  it("fails a stale running row with interruption fields before granting a replacement", async () => {
    const userId = await createUser();
    const repository = createDrizzleSyncRunRepository();
    const startedAt = new Date("2026-08-03T12:00:00.000Z");
    const oldRun = await repository.acquire(userId, startedAt);
    const replacementAt = new Date("2026-08-03T12:15:00.000Z");

    await repository.acquire(userId, replacementAt);

    const [interrupted] = await getDb().select().from(syncRuns).where(eq(syncRuns.id, oldRun.id));
    expect(interrupted).toMatchObject({
      status: "failed",
      failureCode: "SYNC_INTERRUPTED",
      failureMessage: "The previous sorting run did not finish.",
      completedAt: replacementAt,
    });
    await expect(repository.assertActiveLease(oldRun.id, oldRun.leaseToken)).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" });
  });

  it("rejects wrong leases and terminal writes that no longer match a running row", async () => {
    const userId = await createUser();
    const repository = createDrizzleSyncRunRepository();
    const run = await repository.acquire(userId, new Date("2026-08-03T12:00:00.000Z"));
    const completedAt = new Date("2026-08-03T12:01:00.000Z");

    await expect(repository.assertActiveLease(run.id, randomUUID())).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" });
    await expect(repository.succeed(run.id, randomUUID(), counts, completedAt)).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" });
    await expect(repository.succeed(run.id, run.leaseToken, counts, completedAt)).resolves.toMatchObject({ status: "succeeded", counts });
    await expect(repository.fail(run.id, run.leaseToken, counts, { code: "SPOTIFY_UNAVAILABLE", message: "Spotify did not respond." }, completedAt)).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" });
  });

  it("returns the run with the latest start time", async () => {
    const userId = await createUser();
    const repository = createDrizzleSyncRunRepository();
    const first = await repository.acquire(userId, new Date("2026-08-03T12:00:00.000Z"));
    await repository.succeed(first.id, first.leaseToken, counts, new Date("2026-08-03T12:01:00.000Z"));
    const second = await repository.acquire(userId, new Date("2026-08-03T12:02:00.000Z"));

    await expect(repository.latest(userId)).resolves.toMatchObject({ id: second.id, status: "running", startedAt: new Date("2026-08-03T12:02:00.000Z") });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function waitForMappingLock(probe: ReturnType<typeof postgres>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await probe<{ waiting: number }[]>`
      select count(*)::int as waiting
      from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and query like '%generated_playlists%'
    `;
    if (row?.waiting) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("mapping write did not block on the row lock");
}
