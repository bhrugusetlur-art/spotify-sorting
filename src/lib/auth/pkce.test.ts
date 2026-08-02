import { describe, expect, it } from "vitest";
import { createOAuthState, createPkce, deriveChallenge } from "./pkce";

describe("Spotify OAuth primitives", () => {
  // Known-answer vector from RFC 7636 Appendix B. This pins S256 + base64url
  // against a published constant, so an implementation that returned the plain
  // verifier or used hex/standard base64 would fail here.
  it("derives the RFC 7636 Appendix B challenge", () => {
    expect(deriveChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("creates a PKCE pair within the RFC 7636 length bounds", () => {
    const pair = createPkce();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.verifier.length).toBeLessThanOrEqual(128);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.challenge).not.toBe(pair.verifier);
  });

  it("creates unique state values", () => {
    expect(createOAuthState()).not.toBe(createOAuthState());
  });
});
