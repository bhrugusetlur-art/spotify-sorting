import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@db.example.com/app",
  SPOTIFY_CLIENT_ID: "spotify-client",
  SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/spotify/callback",
  SESSION_SECRET: "s".repeat(32),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("parseEnv", () => {
  it("accepts complete server configuration", () => {
    expect(parseEnv(valid).SPOTIFY_CLIENT_ID).toBe("spotify-client");
  });

  it("rejects localhost redirect URIs", () => {
    expect(() =>
      parseEnv({ ...valid, SPOTIFY_REDIRECT_URI: "http://localhost:3000/callback" }),
    ).toThrow();
  });

  it("requires HTTPS outside local development", () => {
    expect(() => parseEnv({ ...valid, SPOTIFY_REDIRECT_URI: "http://example.com/callback" })).toThrow();
  });

  it("rejects hosts that merely start with the loopback address", () => {
    expect(() =>
      parseEnv({ ...valid, SPOTIFY_REDIRECT_URI: "http://127.0.0.1.evil.example/callback" }),
    ).toThrow();
  });

  it("rejects encryption keys that are not 32 bytes", () => {
    expect(() =>
      parseEnv({ ...valid, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow();
  });

  it("rejects encryption keys that are not canonical base64", () => {
    expect(() =>
      parseEnv({
        ...valid,
        TOKEN_ENCRYPTION_KEY: `${Buffer.alloc(32, 7).toString("base64")}!!`,
      }),
    ).toThrow();
  });

  it("rejects database URLs that are not PostgreSQL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://user:pass@db.example.com/app" })).toThrow();
  });
});
