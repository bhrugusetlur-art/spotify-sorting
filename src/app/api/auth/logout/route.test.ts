import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/session";

const logoutCookies = { delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => logoutCookies }));

describe("Spotify logout", () => {
  it("deletes the application session and redirects home", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://127.0.0.1:3000/api/auth/logout", { method: "POST" }));
    expect(logoutCookies.delete).toHaveBeenCalledWith(SESSION_COOKIE);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/");
  });
});
