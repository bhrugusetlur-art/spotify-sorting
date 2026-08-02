import { describe, expect, it } from "vitest";
import { seal, unseal } from "./crypto";

const key = Buffer.alloc(32, 9).toString("base64");

describe("sealed values", () => {
  it("round-trips JSON without exposing plaintext", () => {
    const token = seal({ accessToken: "secret" }, key);
    expect(token).not.toContain("secret");
    expect(unseal<{ accessToken: string }>(token, key)).toEqual({ accessToken: "secret" });
  });

  it("rejects tampering", () => {
    // Flip a ciphertext bit rather than editing the base64url text: replacing the
    // final character can decode to identical bytes and silently pass.
    const bytes = Buffer.from(seal({ value: 1 }, key), "base64url");
    bytes[bytes.length - 1] ^= 0xff;
    expect(() => unseal(bytes.toString("base64url"), key)).toThrow();
  });
});
