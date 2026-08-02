import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: vi.fn().mockResolvedValue({ userId: "u1", spotifyUserId: "s1", displayName: "Ada", imageUrl: null, encryptedAccessToken: "hidden-access", encryptedRefreshToken: "hidden-refresh" }) }));

describe("GET /api/account", () => {
  it("returns only safe account fields", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    expect(await response.json()).toEqual({ userId: "u1", spotifyUserId: "s1", displayName: "Ada", imageUrl: null });
  });
});
