import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
const latest = vi.fn();
const createProductionSyncHandlers = vi.fn(() => ({ post, latest }));

vi.mock("@/lib/sync/production", () => ({ createProductionSyncHandlers }));

describe("POST /api/sync", () => {
  beforeEach(() => {
    post.mockReset();
    latest.mockReset();
    createProductionSyncHandlers.mockClear();
  });

  it("delegates to the production handler and preserves its success response", async () => {
    post.mockResolvedValue(Response.json({ run: { id: "run-1" }, playlists: [] }));
    const { POST } = await import("./route");

    const response = await POST();

    expect(createProductionSyncHandlers).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run: { id: "run-1" }, playlists: [] });
  });

  it("preserves the handler's authorization status and safe error shape", async () => {
    post.mockResolvedValue(Response.json({ error: { code: "AUTH_REQUIRED", message: "Please reconnect your Spotify account and try again." } }, { status: 401 }));
    const { POST } = await import("./route");

    const response = await POST();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED", message: "Please reconnect your Spotify account and try again." } });
  });
});
