import { describe, expect, it } from "vitest";
import { AppError, toErrorCode } from "./errors";

describe("safe application errors", () => {
  it("preserves approved public error codes", () => {
    expect(toErrorCode(new AppError("AUTH_REQUIRED"))).toBe("AUTH_REQUIRED");
  });

  it("preserves pipeline error codes", () => {
    expect(toErrorCode(new AppError("SYNC_ALREADY_RUNNING"))).toBe("SYNC_ALREADY_RUNNING");
    expect(toErrorCode(new AppError("SYNC_INTERRUPTED"))).toBe("SYNC_INTERRUPTED");
    expect(toErrorCode(new AppError("SPOTIFY_RESPONSE_INVALID"))).toBe("SPOTIFY_RESPONSE_INVALID");
  });

  it("hides unknown internal failures", () => {
    expect(toErrorCode(new Error("database password leaked"))).toBe("INTERNAL_ERROR");
  });
});
