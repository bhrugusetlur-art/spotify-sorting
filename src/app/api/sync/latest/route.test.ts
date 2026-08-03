import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
const latest = vi.fn();
const createProductionSyncHandlers = vi.fn(() => ({ post, latest }));

vi.mock("@/lib/sync/production", () => ({ createProductionSyncHandlers }));

describe("GET /api/sync/latest", () => {
  beforeEach(() => {
    post.mockReset();
    latest.mockReset();
    createProductionSyncHandlers.mockClear();
  });

  it("delegates to the production latest handler and preserves the empty result", async () => {
    latest.mockResolvedValue(Response.json({ run: null, playlists: [] }));
    const { GET } = await import("./route");

    const response = await GET();

    expect(createProductionSyncHandlers).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run: null, playlists: [] });
  });

  it("preserves the handler's authorization status and safe error shape", async () => {
    latest.mockResolvedValue(Response.json({ error: { code: "AUTH_REQUIRED", message: "Please reconnect your Spotify account and try again." } }, { status: 401 }));
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED", message: "Please reconnect your Spotify account and try again." } });
  });
});
