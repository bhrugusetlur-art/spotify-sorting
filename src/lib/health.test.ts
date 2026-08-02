import { describe, expect, it } from "vitest";
import { healthStatus } from "./health";

describe("healthStatus", () => {
  it("returns a stable healthy payload", () => {
    expect(healthStatus()).toEqual({ status: "ok" });
  });
});
