import { describe, expect, it } from "vitest";
import { AppError, toErrorCode } from "./errors";

describe("safe application errors", () => {
  it("preserves approved public error codes", () => {
    expect(toErrorCode(new AppError("AUTH_REQUIRED"))).toBe("AUTH_REQUIRED");
  });

  it("hides unknown internal failures", () => {
    expect(toErrorCode(new Error("database password leaked"))).toBe("INTERNAL_ERROR");
  });
});
