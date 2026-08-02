import { createHmac, randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import postgres from "postgres";

function sessionToken(payload: { userId: string; expiresAt: number }, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export async function establishMockCallbackSession(
  context: BrowserContext,
  input: { displayName: string },
): Promise<() => Promise<void>> {
  const databaseUrl = process.env.DATABASE_URL;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!databaseUrl || !sessionSecret) throw new Error("E2E database and session configuration are required");

  const sql = postgres(databaseUrl, { prepare: false });
  const spotifyUserId = `e2e-${randomUUID()}`;
  let userId: string | undefined;

  const cleanup = async () => {
    try {
      if (userId) await sql`delete from users where id = ${userId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  };

  try {
    const [user] = await sql<{ id: string }[]>`
      insert into users (spotify_user_id, display_name)
      values (${spotifyUserId}, ${input.displayName})
      returning id
    `;
    if (!user) throw new Error("E2E user creation failed");
    userId = user.id;
    await sql`
      insert into spotify_accounts
        (user_id, encrypted_access_token, encrypted_refresh_token, scopes, access_token_expires_at)
      values
        (${userId}, 'e2e-access', 'e2e-refresh', 'user-library-read', ${new Date(Date.now() + 3_600_000)})
    `;

    await context.addCookies([
      {
        name: "mood_sorter_session",
        value: sessionToken({ userId, expiresAt: Date.now() + 60_000 }, sessionSecret),
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    return cleanup;
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}
