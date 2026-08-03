"use client";

import { useState } from "react";
import { MOODS, type Mood, type SafeFailure } from "@/lib/sorting/types";
import type { SyncResult } from "@/lib/sync/result";

const moodLabels: Record<Mood, string> = {
  chill: "Chill",
  hype: "Hype",
  focus: "Focus",
  sad: "Sad",
  happy: "Happy",
};

const fallbackFailure = "We could not sort your music. Please try again.";

type DashboardPhase = "idle" | "pending" | "succeeded" | "failed";
type SyncResponse = Partial<SyncResult> & { error?: Partial<SafeFailure> };

export function Dashboard({
  account,
  initialResult,
}: {
  account: { displayName: string | null; imageUrl: string | null };
  initialResult: SyncResult | null;
}) {
  const [result, setResult] = useState<SyncResult | null>(initialResult);
  const [phase, setPhase] = useState<DashboardPhase>(initialResult?.run.status === "failed" ? "failed" : "idle");
  const [message, setMessage] = useState(initialMessage(initialResult));
  const [needsLogin, setNeedsLogin] = useState(initialResult?.run.failure?.code === "AUTH_REQUIRED");

  async function sync() {
    setPhase("pending");
    setMessage("Sorting your music. This can take a moment.");
    setNeedsLogin(false);

    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const payload = await readResponse(response);
      const receivedResult = resultFrom(payload);

      if (response.ok && receivedResult?.run.status === "succeeded") {
        setResult((previous) => mergeResult(previous, receivedResult));
        setPhase("succeeded");
        setMessage("Sorting complete.");
        return;
      }

      if (receivedResult !== null) setResult((previous) => mergeResult(previous, receivedResult));
      const failure = failureFrom(payload);
      setPhase("failed");
      setMessage(failure.message);
      setNeedsLogin(response.status === 401 || failure.code === "AUTH_REQUIRED");
    } catch {
      setPhase("failed");
      setMessage(fallbackFailure);
    }
  }

  const isPending = phase === "pending";
  const actionLabel = isPending ? "Sorting music…" : phase === "failed" ? "Retry sorting" : "Sort My Music";

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-14">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-emerald-400">Connected as {account.displayName ?? "Spotify user"}</p>
          <h1 className="mt-3 text-4xl font-bold">Your mood playlists</h1>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="rounded-full border border-zinc-700 px-4 py-2">Log out</button>
        </form>
      </div>

      <section aria-label="Mood destinations" className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {MOODS.map((mood) => {
          const playlist = result?.playlists.find((entry) => entry.mood === mood);
          return (
            <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5" key={mood}>
              <h2 className="font-semibold">{moodLabels[mood]}</h2>
              {playlist ? (
                <a
                  className="mt-2 inline-block text-sm text-emerald-400 underline-offset-4 hover:underline"
                  href={playlist.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open in Spotify
                </a>
              ) : <p className="mt-2 text-sm text-zinc-400">Ready for sorting</p>}
            </article>
          );
        })}
      </section>

      {result && <ResultSummary result={result} />}

      <div className="mt-10">
        {!needsLogin && (
          <button
            className="rounded-full bg-emerald-400 px-6 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isPending}
            onClick={sync}
            type="button"
          >
            {actionLabel}
          </button>
        )}
        <p aria-live="polite" className="mt-3 text-sm text-zinc-400" role="status">
          {message}
        </p>
        {needsLogin && (
          <a className="mt-3 inline-block text-sm text-emerald-400 underline-offset-4 hover:underline" href="/api/auth/spotify/start">
            Log in again
          </a>
        )}
      </div>
    </main>
  );
}

function ResultSummary({ result }: { result: SyncResult }) {
  const { counts } = result.run;
  return (
    <section aria-label="Latest sorting result" className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="font-semibold">Latest sorting result</h2>
      <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-5">
        <p>Total: {counts.total}</p>
        <p>Classified: {counts.classified}</p>
        <p>Added: {counts.added}</p>
        <p>Skipped: {counts.skipped}</p>
        <p>Failed: {counts.failed}</p>
      </div>
    </section>
  );
}

function initialMessage(result: SyncResult | null): string {
  if (result?.run.status === "failed") return result.run.failure?.message ?? fallbackFailure;
  return result?.run.status === "succeeded" ? "Sorting complete." : "Ready to sort your saved music.";
}

async function readResponse(response: Response): Promise<SyncResponse | null> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" && value !== null ? value as SyncResponse : null;
  } catch {
    return null;
  }
}

function resultFrom(payload: SyncResponse | null): SyncResult | null {
  if (!payload || !isSyncRun(payload.run) || !Array.isArray(payload.playlists)) return null;
  return payload as SyncResult;
}

function failureFrom(payload: SyncResponse | null): SafeFailure {
  if (typeof payload?.error?.code === "string" && typeof payload.error.message === "string") {
    return { code: payload.error.code as SafeFailure["code"], message: payload.error.message };
  }
  return { code: "INTERNAL_ERROR", message: fallbackFailure };
}

function isSyncRun(run: SyncResponse["run"]): run is SyncResult["run"] {
  return typeof run === "object" && run !== null
    && (run.status === "succeeded" || run.status === "failed" || run.status === "running")
    && typeof run.counts === "object" && run.counts !== null;
}

function mergeResult(previous: SyncResult | null, next: SyncResult): SyncResult {
  if (previous === null) return next;
  const playlists = new Map(previous.playlists.map((playlist) => [playlist.mood, playlist]));
  for (const playlist of next.playlists) playlists.set(playlist.mood, playlist);
  return { ...next, playlists: MOODS.flatMap((mood) => {
    const playlist = playlists.get(mood);
    return playlist ? [playlist] : [];
  }) };
}
