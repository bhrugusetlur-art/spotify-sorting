import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { createDrizzleClassificationRepository } from "@/lib/sync/classification-repository";
import { createDrizzleGeneratedPlaylistRepository } from "@/lib/sync/playlist-repository";
import { createDrizzleSyncRunRepository } from "@/lib/sync/run-repository";
import { createSyncService, type SpotifyWebApiPort } from "@/lib/sync/service";

export default async function DashboardPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/");

  const initialResult = await createSyncService({
    spotify: {} as SpotifyWebApiPort,
    classifications: createDrizzleClassificationRepository(),
    playlists: createDrizzleGeneratedPlaylistRepository(),
    runs: createDrizzleSyncRunRepository(),
    now: () => new Date(),
  }).loadLatestSyncResult(account.userId);

  return <Dashboard account={{ displayName: account.displayName, imageUrl: account.imageUrl }} initialResult={initialResult} />;
}
