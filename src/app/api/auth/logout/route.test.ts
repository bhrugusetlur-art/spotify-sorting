import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/session";

const logoutCookies = { delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => logoutCookies }));

describe("Spotify logout", () => {
  beforeEach(() => {
    logoutCookies.delete.mockReset();
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/app",
      SPOTIFY_CLIENT_ID: "client",
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/spotify/callback",
      SESSION_SECRET: "s".repeat(32),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString("base64"),
    });
  });

  it("deletes the application session and redirects home", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://127.0.0.1:3000/api/auth/logout", { method: "POST" }));
    expect(logoutCookies.delete).toHaveBeenCalledWith(SESSION_COOKIE);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/");
  });

  it("redirects hostile-origin requests to the configured application origin", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("https://attacker.example/api/auth/logout", { method: "POST" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/");
  });
});
