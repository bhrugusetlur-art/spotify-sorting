import "server-only";
import { randomUUID as nodeRandomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { AppError, type ErrorCode } from "@/lib/errors";
import { getDb } from "@/lib/db/client";
import { syncRuns } from "@/lib/db/schema";
import type { SafeFailure, SyncCounts } from "@/lib/sorting/types";

const LEASE_DURATION_MS = 15 * 60_000;
const INTERRUPTED_MESSAGE = "The previous sorting run did not finish.";
const EMPTY_COUNTS: SyncCounts = { total: 0, classified: 0, added: 0, skipped: 0, failed: 0 };

export type SyncRunStatus = "running" | "succeeded" | "failed";

export type SyncRun = {
  id: string;
  userId: string;
  status: SyncRunStatus;
  counts: SyncCounts;
  failure: SafeFailure | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type ActiveSyncRun = Pick<SyncRun, "id" | "userId" | "startedAt"> & { leaseToken: string };

export interface SyncRunRepository {
  acquire(userId: string, now: Date): Promise<ActiveSyncRun>;
  assertActiveLease(runId: string, leaseToken: string): Promise<void>;
  succeed(runId: string, leaseToken: string, counts: SyncCounts, completedAt: Date): Promise<SyncRun>;
  fail(runId: string, leaseToken: string, counts: SyncCounts, failure: SafeFailure, completedAt: Date): Promise<SyncRun>;
  latest(userId: string): Promise<SyncRun | null>;
}

export function createMemorySyncRunRepository(dependencies: { randomUUID?: () => string } = {}): SyncRunRepository {
  const randomUUID = dependencies.randomUUID ?? nodeRandomUUID;
  const values = new Map<string, StoredSyncRun>();
  let nextId = 1;

  return {
    async acquire(userId, now) {
      const current = [...values.values()].find((value) => value.userId === userId && value.status === "running");
      if (current !== undefined) {
        if (now.getTime() - current.startedAt.getTime() < LEASE_DURATION_MS) throw new AppError("SYNC_ALREADY_RUNNING");
        interrupt(current, now);
      }

      const active: StoredSyncRun = {
        id: `run-${nextId++}`,
        userId,
        leaseToken: randomUUID(),
        status: "running",
        counts: { ...EMPTY_COUNTS },
        failure: null,
        startedAt: new Date(now),
        completedAt: null,
      };
      values.set(active.id, active);
      return toActiveSyncRun(active);
    },
    async assertActiveLease(runId, leaseToken) {
      const run = values.get(runId);
      if (run?.status !== "running" || run.leaseToken !== leaseToken) throw new AppError("SYNC_INTERRUPTED");
    },
    async succeed(runId, leaseToken, counts, completedAt) {
      return complete(values, runId, leaseToken, counts, null, completedAt);
    },
    async fail(runId, leaseToken, counts, failure, completedAt) {
      return complete(values, runId, leaseToken, counts, failure, completedAt);
    },
    async latest(userId) {
      const latest = [...values.values()]
        .filter((value) => value.userId === userId)
        .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime() || right.id.localeCompare(left.id))[0];
      return latest === undefined ? null : toMemorySyncRun(latest);
    },
  };
}

export function createDrizzleSyncRunRepository(
  db = getDb(),
  dependencies: { randomUUID?: () => string } = {},
): SyncRunRepository {
  const randomUUID = dependencies.randomUUID ?? nodeRandomUUID;

  return {
    async acquire(userId, now) {
      const leaseToken = randomUUID();
      try {
        return await db.transaction(async (tx) => {
          const [current] = await tx.select().from(syncRuns).where(and(
            eq(syncRuns.userId, userId),
            eq(syncRuns.status, "running"),
          )).for("update").limit(1);

          if (current !== undefined) {
            if (now.getTime() - current.startedAt.getTime() < LEASE_DURATION_MS) throw new AppError("SYNC_ALREADY_RUNNING");
            await tx.update(syncRuns).set({
              status: "failed",
              failureCode: "SYNC_INTERRUPTED",
              failureMessage: INTERRUPTED_MESSAGE,
              completedAt: now,
            }).where(and(eq(syncRuns.id, current.id), eq(syncRuns.status, "running")));
          }

          const [run] = await tx.insert(syncRuns).values({ userId, leaseToken, status: "running", startedAt: now }).returning();
          return { id: run.id, userId: run.userId, leaseToken, startedAt: run.startedAt };
        });
      } catch (error) {
        if (error instanceof AppError || !isUniqueConstraintViolation(error)) throw error;
        throw new AppError("SYNC_ALREADY_RUNNING");
      }
    },
    async assertActiveLease(runId, leaseToken) {
      const [run] = await db.select({ id: syncRuns.id }).from(syncRuns).where(and(
        eq(syncRuns.id, runId),
        eq(syncRuns.leaseToken, leaseToken),
        eq(syncRuns.status, "running"),
      )).limit(1);
      if (run === undefined) throw new AppError("SYNC_INTERRUPTED");
    },
    async succeed(runId, leaseToken, counts, completedAt) {
      return completeDrizzleRun(db, runId, leaseToken, counts, null, completedAt);
    },
    async fail(runId, leaseToken, counts, failure, completedAt) {
      return completeDrizzleRun(db, runId, leaseToken, counts, failure, completedAt);
    },
    async latest(userId) {
      const [run] = await db.select().from(syncRuns).where(eq(syncRuns.userId, userId))
        .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id)).limit(1);
      return run === undefined ? null : toDrizzleSyncRun(run);
    },
  };
}

type StoredSyncRun = SyncRun & { leaseToken: string };

function interrupt(run: StoredSyncRun, completedAt: Date): void {
  run.status = "failed";
  run.failure = { code: "SYNC_INTERRUPTED", message: INTERRUPTED_MESSAGE };
  run.completedAt = new Date(completedAt);
}

function complete(
  values: Map<string, StoredSyncRun>,
  runId: string,
  leaseToken: string,
  counts: SyncCounts,
  failure: SafeFailure | null,
  completedAt: Date,
): SyncRun {
  const run = values.get(runId);
  if (run?.status !== "running" || run.leaseToken !== leaseToken) throw new AppError("SYNC_INTERRUPTED");
  run.status = failure === null ? "succeeded" : "failed";
  run.counts = { ...counts };
  run.failure = failure === null ? null : { ...failure };
  run.completedAt = new Date(completedAt);
  return toMemorySyncRun(run);
}

async function completeDrizzleRun(
  db: ReturnType<typeof getDb>,
  runId: string,
  leaseToken: string,
  counts: SyncCounts,
  failure: SafeFailure | null,
  completedAt: Date,
): Promise<SyncRun> {
  const [run] = await db.update(syncRuns).set({
    status: failure === null ? "succeeded" : "failed",
    totalCount: counts.total,
    classifiedCount: counts.classified,
    addedCount: counts.added,
    skippedCount: counts.skipped,
    failedCount: counts.failed,
    failureCode: failure?.code ?? null,
    failureMessage: failure?.message ?? null,
    completedAt,
  }).where(and(
    eq(syncRuns.id, runId),
    eq(syncRuns.leaseToken, leaseToken),
    eq(syncRuns.status, "running"),
  )).returning();
  if (run === undefined) throw new AppError("SYNC_INTERRUPTED");
  return toDrizzleSyncRun(run);
}

function toActiveSyncRun(run: StoredSyncRun): ActiveSyncRun {
  return { id: run.id, userId: run.userId, leaseToken: run.leaseToken, startedAt: new Date(run.startedAt) };
}

function toMemorySyncRun(row: StoredSyncRun): SyncRun {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    counts: {
      total: row.counts.total,
      classified: row.counts.classified,
      added: row.counts.added,
      skipped: row.counts.skipped,
      failed: row.counts.failed,
    },
    failure: row.failure === null ? null : { ...row.failure },
    startedAt: new Date(row.startedAt),
    completedAt: row.completedAt === null ? null : new Date(row.completedAt),
  };
}

function toDrizzleSyncRun(row: typeof syncRuns.$inferSelect): SyncRun {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    counts: {
      total: row.totalCount,
      classified: row.classifiedCount,
      added: row.addedCount,
      skipped: row.skippedCount,
      failed: row.failedCount,
    },
    failure: row.failureCode === null || row.failureMessage === null
      ? null
      : { code: row.failureCode as ErrorCode, message: row.failureMessage },
    startedAt: new Date(row.startedAt),
    completedAt: row.completedAt === null ? null : new Date(row.completedAt),
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && typeof error.cause === "object" && error.cause !== null
    && "code" in error.cause && error.cause.code === "23505";
}
