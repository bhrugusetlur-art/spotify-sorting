import "server-only";
import { z } from "zod";

// Buffer.from(…, "base64") silently ignores trailing garbage, so require a
// canonical round-trip rather than trusting the decoded length alone.
const encryptionKey = z.string().refine((value) => {
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value;
}, "TOKEN_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key");

const databaseUrl = z.string().refine((value) => {
  try {
    return ["postgresql:", "postgres:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "DATABASE_URL must be a PostgreSQL connection string");

// Compare the parsed hostname exactly: a startsWith check would accept
// hosts such as http://127.0.0.1.evil.example.
const redirectUri = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}, "Use HTTPS, or 127.0.0.1 for local redirects");

const schema = z.object({
  DATABASE_URL: databaseUrl,
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_REDIRECT_URI: redirectUri,
  SESSION_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: encryptionKey,
});

export type ServerEnv = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  return schema.parse(source);
}

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  return (cached ??= parseEnv(process.env));
}
