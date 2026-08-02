import { beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "@/lib/security/crypto";
import { OAUTH_COOKIE } from "./oauth-cookie";

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const encryptionKey = Buffer.alloc(32, 6).toString("base64");
const spotify = () => ({ exchangeCode: vi.fn(), profile: vi.fn() });

describe("Spotify callback handler", () => {
  beforeEach(() => {
    cookieStore.get.mockReset(); cookieStore.set.mockReset(); cookieStore.delete.mockReset();
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/app",
      SPOTIFY_CLIENT_ID: "client",
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/spotify/callback",
      SESSION_SECRET: "s".repeat(32),
      TOKEN_ENCRYPTION_KEY: encryptionKey,
    });
  });

  it("redirects invalid callback state without calling Spotify", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const { createCallbackHandler } = await import("./callback-handler");
    const ports = spotify();
    const handler = createCallbackHandler({ repository: { upsert: vi.fn(), findByUserId: vi.fn() }, spotify: ports, now: () => new Date(1_000) });
    const response = await handler(new Request("http://127.0.0.1:3000/api/auth/spotify/callback?code=x&state=y"));
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/?error=AUTH_STATE_INVALID");
    expect(ports.exchangeCode).not.toHaveBeenCalled();
    expect(ports.profile).not.toHaveBeenCalled();
  });

  it("reports a denied consent screen once the state proves the request is ours", async () => {
    cookieStore.get.mockReturnValue({ value: seal({ state: "state-1", verifier: "verifier", expiresAt: 9_000 }, encryptionKey) });
    const { createCallbackHandler } = await import("./callback-handler");
    const ports = spotify();
    const handler = createCallbackHandler({ repository: { upsert: vi.fn(), findByUserId: vi.fn() }, spotify: ports, now: () => new Date(1_000) });
    const response = await handler(new Request("http://127.0.0.1:3000/api/auth/spotify/callback?error=access_denied&state=state-1"));
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/?error=SPOTIFY_PERMISSION_DENIED");
    expect(cookieStore.delete).toHaveBeenCalledWith(OAUTH_COOKIE);
    expect(ports.exchangeCode).not.toHaveBeenCalled();
  });

  it("keeps the pending login intact when a forged error carries the wrong state", async () => {
    cookieStore.get.mockReturnValue({ value: seal({ state: "state-1", verifier: "verifier", expiresAt: 9_000 }, encryptionKey) });
    const { createCallbackHandler } = await import("./callback-handler");
    const handler = createCallbackHandler({ repository: { upsert: vi.fn(), findByUserId: vi.fn() }, spotify: spotify(), now: () => new Date(1_000) });
    const response = await handler(new Request("http://127.0.0.1:3000/api/auth/spotify/callback?error=access_denied&state=attacker"));
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/?error=AUTH_STATE_INVALID");
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("rejects an expired OAuth transaction", async () => {
    cookieStore.get.mockReturnValue({ value: seal({ state: "state-1", verifier: "verifier", expiresAt: 500 }, encryptionKey) });
    const { createCallbackHandler } = await import("./callback-handler");
    const ports = spotify();
    const handler = createCallbackHandler({ repository: { upsert: vi.fn(), findByUserId: vi.fn() }, spotify: ports, now: () => new Date(1_000) });
    const response = await handler(new Request("http://127.0.0.1:3000/api/auth/spotify/callback?code=x&state=state-1"));
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/?error=AUTH_STATE_INVALID");
    expect(ports.exchangeCode).not.toHaveBeenCalled();
  });
});
