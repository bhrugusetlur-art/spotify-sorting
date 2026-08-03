import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { createDrizzleClassificationRepository } from "@/lib/sync/classification-repository";
import { createDrizzleGeneratedPlaylistRepository } from "@/lib/sync/playlist-repository";
import { toPublicSyncResult } from "@/lib/sync/result";
import { createDrizzleSyncRunRepository } from "@/lib/sync/run-repository";
import { createSyncService, type SpotifyWebApiPort } from "@/lib/sync/service";

export default async function DashboardPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/");

  const persistedResult = await createSyncService({
    spotify: {} as SpotifyWebApiPort,
    classifications: createDrizzleClassificationRepository(),
    playlists: createDrizzleGeneratedPlaylistRepository(),
    runs: createDrizzleSyncRunRepository(),
    now: () => new Date(),
  }).loadLatestSyncResult(account.userId);
  const initialResult = persistedResult === null ? null : toPublicSyncResult(persistedResult);

  return <Dashboard account={{ displayName: account.displayName, imageUrl: account.imageUrl }} initialResult={initialResult} />;
}
