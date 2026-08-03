import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncResult } from "@/lib/sync/result";
import { Dashboard } from "./dashboard";

const moods = ["chill", "hype", "focus", "sad", "happy"] as const;

function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    run: {
      id: "run-1",
      userId: "user-1",
      status: "succeeded",
      counts: { total: 12, classified: 10, added: 8, skipped: 1, failed: 2 },
      failure: null,
      startedAt: new Date("2026-08-03T12:00:00.000Z"),
      completedAt: new Date("2026-08-03T12:00:02.000Z"),
    },
    playlists: moods.map((mood) => ({
      mood,
      name: `Mood Sorter — ${mood}`,
      spotifyPlaylistId: `playlist-${mood}`,
      url: `https://open.spotify.com/playlist/playlist-${mood}`,
    })),
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Dashboard", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("shows the linked account, five mood destinations, and an enabled sort action", () => {
    render(<Dashboard account={{ displayName: "Ada", imageUrl: null }} initialResult={null} />);

    expect(screen.getByText(/connected as ada/i)).toBeInTheDocument();
    for (const mood of ["Chill", "Hype", "Focus", "Sad", "Happy"]) {
      expect(screen.getByText(mood)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /sort my music/i })).toBeEnabled();
  });

  it("disables sorting and announces a pending status until the request resolves", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => { resolve = done; }));
    render(<Dashboard account={{ displayName: "Ada", imageUrl: null }} initialResult={null} />);

    fireEvent.click(screen.getByRole("button", { name: /sort my music/i }));

    expect(fetchMock).toHaveBeenCalledWith("/api/sync", { method: "POST" });
    expect(screen.getByRole("button", { name: /sorting music/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/sorting your music/i);

    resolve(response(result()));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/sorting complete/i));
  });

  it("renders persisted success counts and five secure Spotify links", () => {
    render(<Dashboard account={{ displayName: "Ada", imageUrl: null }} initialResult={result()} />);

    expect(screen.getByText("Total: 12")).toBeInTheDocument();
    expect(screen.getByText("Classified: 10")).toBeInTheDocument();
    expect(screen.getByText("Added: 8")).toBeInTheDocument();
    expect(screen.getByText("Skipped: 1")).toBeInTheDocument();
    expect(screen.getByText("Failed: 2")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /open in spotify/i });
    expect(links).toHaveLength(5);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });

  it("shows a safe failure and allows the user to retry", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ error: { code: "SPOTIFY_UNAVAILABLE", message: "Spotify could not complete the sorting request. Please try again." } }, 502))
      .mockResolvedValueOnce(response(result()));
    render(<Dashboard account={{ displayName: "Ada", imageUrl: null }} initialResult={null} />);

    fireEvent.click(screen.getByRole("button", { name: /sort my music/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Spotify could not complete the sorting request. Please try again.");
    expect(screen.getByRole("button", { name: /retry sorting/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /retry sorting/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/sorting complete/i));
  });

  it("preserves existing playlist links when a later sync fails with partial data", async () => {
    const partial = result({ playlists: [result().playlists[0]] });
    partial.run = { ...partial.run, status: "failed", failure: { code: "SPOTIFY_UNAVAILABLE", message: "Spotify could not complete the sorting request. Please try again." } };
    fetchMock.mockResolvedValueOnce(response({ error: partial.run.failure, ...partial }, 502));
    render(<Dashboard account={{ displayName: "Ada", imageUrl: null }} initialResult={result()} />);

    fireEvent.click(screen.getByRole("button", { name: /sort my music/i }));

    await screen.findByRole("status");
    expect(screen.getAllByRole("link", { name: /open in spotify/i })).toHaveLength(5);
  });

  it("reports a 409 without automatically issuing another sync request", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "SYNC_ALREADY_RUNNING", message: "A sorting run is already in progress." } }, 409));
    render(<Dashboard account={{ displayName: "Ada", imageUrl: null }} initialResult={null} />);

    fireEvent.click(screen.getByRole("button", { name: /sort my music/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("A sorting run is already in progress.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /retry sorting/i })).toBeEnabled();
  });

  it("offers a login link after an unauthorized sync response", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "AUTH_REQUIRED", message: "Please reconnect your Spotify account and try again." } }, 401));
    render(<Dashboard account={{ displayName: "Ada", imageUrl: null }} initialResult={null} />);

    fireEvent.click(screen.getByRole("button", { name: /sort my music/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/reconnect your spotify account/i);
    expect(screen.getByRole("link", { name: /log in again/i })).toHaveAttribute("href", "/api/auth/spotify/start");
  });
});
