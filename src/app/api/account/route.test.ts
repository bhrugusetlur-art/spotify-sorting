import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentAccount = vi.fn();
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount }));

describe("GET /api/account", () => {
  beforeEach(() => {
    getCurrentAccount.mockReset();
  });

  it("returns only safe account fields", async () => {
    getCurrentAccount.mockResolvedValue({ userId: "u1", spotifyUserId: "s1", displayName: "Ada", imageUrl: null, encryptedAccessToken: "hidden-access", encryptedRefreshToken: "hidden-refresh" });
    const { GET } = await import("./route");
    const response = await GET();
    expect(await response.json()).toEqual({ userId: "u1", spotifyUserId: "s1", displayName: "Ada", imageUrl: null });
  });

  it("returns unauthorized when the session is invalid", async () => {
    getCurrentAccount.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED" } });
  });

  it("returns unauthorized when the session user has no linked account", async () => {
    getCurrentAccount.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED" } });
  });
});
