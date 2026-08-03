import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionCookies = { delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => sessionCookies }));

import { clearSession, createSessionToken, readSessionToken, SESSION_COOKIE } from "./session";

describe("application sessions", () => {
  beforeEach(() => {
    sessionCookies.delete.mockReset();
  });

  it("round-trips a signed user session", () => {
    const token = createSessionToken({ userId: "user-123", expiresAt: 2_000 }, "x".repeat(32));
    expect(readSessionToken(token, "x".repeat(32), 1_000)).toEqual({ userId: "user-123", expiresAt: 2_000 });
  });

  it("rejects expired sessions", () => {
    const token = createSessionToken({ userId: "user-123", expiresAt: 2_000 }, "x".repeat(32));
    expect(readSessionToken(token, "x".repeat(32), 2_001)).toBeNull();
  });

  it("rejects a valid payload carrying a forged signature", () => {
    const [encoded] = createSessionToken({ userId: "user-123", expiresAt: 2_000 }, "x".repeat(32)).split(".");
    expect(readSessionToken(`${encoded}.${"a".repeat(43)}`, "x".repeat(32), 1_000)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken({ userId: "user-123", expiresAt: 2_000 }, "y".repeat(32));
    expect(readSessionToken(token, "x".repeat(32), 1_000)).toBeNull();
  });

  it("rejects a valid token with an extra segment", () => {
    const token = createSessionToken({ userId: "user-123", expiresAt: 2_000 }, "x".repeat(32));
    expect(readSessionToken(`${token}.extra`, "x".repeat(32), 1_000)).toBeNull();
  });

  it("returns null rather than throwing on a multibyte signature", () => {
    // 43 CJK characters: same UTF-16 length as a real signature, 3x the bytes.
    const [encoded] = createSessionToken({ userId: "user-123", expiresAt: 2_000 }, "x".repeat(32)).split(".");
    expect(readSessionToken(`${encoded}.${"日".repeat(43)}`, "x".repeat(32), 1_000)).toBeNull();
  });

  it("clears the application session cookie", async () => {
    await clearSession();

    expect(sessionCookies.delete).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});
