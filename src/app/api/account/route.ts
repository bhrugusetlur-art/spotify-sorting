import { getCurrentAccount } from "@/lib/auth/current-user";

export async function GET(): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) return Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });
  return Response.json({
    userId: account.userId,
    spotifyUserId: account.spotifyUserId,
    displayName: account.displayName,
    imageUrl: account.imageUrl,
  });
}
