import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAUTH_COOKIE } from "@/lib/auth/oauth-cookie";

const startCookies = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => startCookies }));

describe("Spotify authorization start", () => {
  beforeEach(() => {
    startCookies.set.mockReset();
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/app",
      SPOTIFY_CLIENT_ID: "client",
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/spotify/callback",
      SESSION_SECRET: "s".repeat(32),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString("base64"),
    });
  });

  it("sets an encrypted OAuth cookie and redirects to Spotify", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    const location = new URL(response.headers.get("location")!);
    expect(location.hostname).toBe("accounts.spotify.com");
    expect(startCookies.set).toHaveBeenCalledWith(OAUTH_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true, maxAge: 300 }));
    const sealed = startCookies.set.mock.calls[0]?.[1] as string;
    expect(sealed).not.toContain(location.searchParams.get("code_challenge"));
  });
});
