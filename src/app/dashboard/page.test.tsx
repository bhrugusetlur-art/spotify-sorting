import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  loadLatestSyncResult: vi.fn(),
  dashboard: vi.fn(({ initialResult }: { initialResult: unknown }) => (
    <pre data-testid="dashboard-payload">{JSON.stringify(initialResult)}</pre>
  )),
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: mocks.getCurrentAccount }));
vi.mock("@/components/dashboard", () => ({ Dashboard: mocks.dashboard }));
vi.mock("@/lib/sync/classification-repository", () => ({ createDrizzleClassificationRepository: vi.fn() }));
vi.mock("@/lib/sync/playlist-repository", () => ({ createDrizzleGeneratedPlaylistRepository: vi.fn() }));
vi.mock("@/lib/sync/run-repository", () => ({ createDrizzleSyncRunRepository: vi.fn() }));
vi.mock("@/lib/sync/service", () => ({
  createSyncService: vi.fn(() => ({ loadLatestSyncResult: mocks.loadLatestSyncResult })),
}));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  beforeEach(() => {
    mocks.getCurrentAccount.mockResolvedValue({ userId: "user-1", displayName: "Ada", imageUrl: null });
    mocks.loadLatestSyncResult.mockResolvedValue({
      run: {
        id: "run-1",
        userId: "internal-user-id",
        status: "failed",
        counts: { total: 4, classified: 3, added: 1, skipped: 1, failed: 2 },
        failure: { code: "UNKNOWN_STORED_CODE", message: "refresh_token=secret" },
        startedAt: new Date("2026-08-03T12:00:00.000Z"),
        completedAt: new Date("2026-08-03T12:01:00.000Z"),
      },
      playlists: [],
    });
  });

  it("passes only a sanitized public persisted result to the client dashboard", async () => {
    render(await DashboardPage());

    expect(mocks.loadLatestSyncResult).toHaveBeenCalledWith("user-1");
    expect(screen.getByTestId("dashboard-payload")).toHaveTextContent(JSON.stringify({
      run: {
        id: "run-1",
        status: "failed",
        counts: { total: 4, classified: 3, added: 1, skipped: 1, failed: 2 },
        failure: { code: "INTERNAL_ERROR", message: "We could not sort your music. Please try again." },
        startedAt: "2026-08-03T12:00:00.000Z",
        completedAt: "2026-08-03T12:01:00.000Z",
      },
      playlists: [],
    }));
    expect(screen.getByTestId("dashboard-payload")).not.toHaveTextContent("internal-user-id");
    expect(screen.getByTestId("dashboard-payload")).not.toHaveTextContent("refresh_token=secret");
  });
});
