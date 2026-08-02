import "server-only";
import { createHash, randomBytes } from "node:crypto";

export function createOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export function deriveChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: deriveChallenge(verifier) };
}
