import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "mood_sorter_session";
export type SessionPayload = { userId: string; expiresAt: number };

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function createSessionToken(payload: SessionPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

// Reject anything that is not base64url before decoding: Buffer.from is lenient,
// and comparing string lengths of multibyte input against byte buffers makes
// timingSafeEqual throw a RangeError instead of returning null.
function decodeBase64Url(value: string): Buffer | null {
  return /^[A-Za-z0-9_-]+$/.test(value) ? Buffer.from(value, "base64url") : null;
}

export function readSessionToken(token: string, secret: string, now = Date.now()): SessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const provided = decodeBase64Url(signature);
  if (!provided) return null;
  const expected = Buffer.from(sign(encoded, secret), "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    return payload.expiresAt > now ? payload : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};
