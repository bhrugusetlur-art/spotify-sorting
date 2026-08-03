import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  loadLatestSyncResult: vi.fn(),
  dashboard: vi.fn(({ initialResult }: { initialResult: { run: { id: string } } | null }) => <p>Loaded {initialResult?.run.id}</p>),
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
    mocks.loadLatestSyncResult.mockResolvedValue({ run: { id: "run-1" }, playlists: [] });
  });

  it("loads the authenticated account's persisted sync result for the dashboard", async () => {
    render(await DashboardPage());

    expect(mocks.loadLatestSyncResult).toHaveBeenCalledWith("user-1");
    expect(screen.getByText("Loaded run-1")).toBeInTheDocument();
  });
});
