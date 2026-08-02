import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function seal(value: unknown, encodedKey: string): string {
  const key = Buffer.from(encodedKey, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function unseal<T>(token: string, encodedKey: string): T {
  const payload = Buffer.from(token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(encodedKey, "base64"), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  const plaintext = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
