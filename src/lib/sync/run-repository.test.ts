import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { createMemorySyncRunRepository } from "./run-repository";

const counts = { total: 8, classified: 6, added: 4, skipped: 2, failed: 0 };
const startedAt = new Date("2026-08-03T12:00:00.000Z");

function repository() {
  let number = 0;
  return createMemorySyncRunRepository({ randomUUID: () => `lease-${++number}` });
}

describe("memory sync-run repository", () => {
  it("rejects acquiring a fresh concurrent lease", async () => {
    const runs = repository();
    await runs.acquire("user-1", startedAt);

    await expect(runs.acquire("user-1", new Date(startedAt.getTime() + (15 * 60_000) - 1))).rejects.toMatchObject({
      code: "SYNC_ALREADY_RUNNING",
    } satisfies Partial<AppError>);
  });

  it("replaces a lease that is exactly fifteen minutes old and records interruption details", async () => {
    const runs = repository();
    const oldRun = await runs.acquire("user-1", startedAt);
    const replacementAt = new Date(startedAt.getTime() + (15 * 60_000));

    const replacement = await runs.acquire("user-1", replacementAt);

    expect(replacement).toEqual({ id: "run-2", userId: "user-1", leaseToken: "lease-2", startedAt: replacementAt });
    await expect(runs.latest("user-1")).resolves.toEqual({
      id: replacement.id,
      userId: "user-1",
      status: "running",
      counts: { total: 0, classified: 0, added: 0, skipped: 0, failed: 0 },
      failure: null,
      startedAt: replacementAt,
      completedAt: null,
    });
    await expect(runs.assertActiveLease(oldRun.id, oldRun.leaseToken)).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" } satisfies Partial<AppError>);
  });

  it("fences an old lease from terminal updates after it is replaced", async () => {
    const runs = repository();
    const oldRun = await runs.acquire("user-1", startedAt);
    await runs.acquire("user-1", new Date(startedAt.getTime() + (15 * 60_000)));

    await expect(runs.succeed(oldRun.id, oldRun.leaseToken, counts, new Date("2026-08-03T12:20:00.000Z"))).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" } satisfies Partial<AppError>);
  });

  it("records a terminal result only for the active lease", async () => {
    const runs = repository();
    const run = await runs.acquire("user-1", startedAt);
    const completedAt = new Date("2026-08-03T12:01:00.000Z");

    await expect(runs.succeed(run.id, run.leaseToken, counts, completedAt)).resolves.toEqual({
      id: run.id,
      userId: "user-1",
      status: "succeeded",
      counts,
      failure: null,
      startedAt,
      completedAt,
    });
    await expect(runs.fail(run.id, run.leaseToken, counts, { code: "SPOTIFY_UNAVAILABLE", message: "Spotify did not respond." }, completedAt)).rejects.toMatchObject({ code: "SYNC_INTERRUPTED" } satisfies Partial<AppError>);
  });

  it("returns the most recently started run for a user", async () => {
    const runs = repository();
    const first = await runs.acquire("user-1", startedAt);
    await runs.succeed(first.id, first.leaseToken, counts, new Date("2026-08-03T12:01:00.000Z"));
    const secondAt = new Date("2026-08-03T12:02:00.000Z");
    const second = await runs.acquire("user-1", secondAt);

    await expect(runs.latest("user-1")).resolves.toMatchObject({ id: second.id, status: "running", startedAt: secondAt });
  });
});
