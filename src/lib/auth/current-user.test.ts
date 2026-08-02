import { describe, expect, it, vi } from "vitest";
import { createSessionToken } from "./session";
import { resolveCurrentAccount } from "./current-user";

describe("resolveCurrentAccount", () => {
  it("loads the account referenced by a valid session", async () => {
    const secret = "s".repeat(32);
    const token = createSessionToken({ userId: "user-1", expiresAt: 2_000 }, secret);
    const repository = { upsert: vi.fn(), findByUserId: vi.fn().mockResolvedValue({ userId: "user-1" }) };
    await expect(resolveCurrentAccount(token, secret, repository, 1_000)).resolves.toEqual({ userId: "user-1" });
  });
});
