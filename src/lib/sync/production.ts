import "server-only";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { createDrizzleAccountRepository } from "@/lib/auth/repository";
import { clearSession } from "@/lib/auth/session";
import { getValidSpotifyAccessToken } from "@/lib/auth/token-service";
import { getEnv } from "@/lib/config/env";
import { SpotifyOAuthClient } from "@/lib/spotify/oauth";
import { SpotifyWebApi } from "@/lib/spotify/web-api";
import { createDrizzleClassificationRepository } from "./classification-repository";
import { createSyncHandlers, type SyncHandlers } from "./handlers";
import { createDrizzleGeneratedPlaylistRepository } from "./playlist-repository";
import { createDrizzleSyncRunRepository } from "./run-repository";
import { createSyncService, type SpotifyWebApiPort } from "./service";

export function createProductionSyncHandlers(): SyncHandlers {
  return createSyncHandlers({
    currentAccount: getCurrentAccount,
    syncLibrary: async (input) => {
      const env = getEnv();
      const accounts = createDrizzleAccountRepository();
      const oauth = new SpotifyOAuthClient({
        clientId: env.SPOTIFY_CLIENT_ID,
        redirectUri: env.SPOTIFY_REDIRECT_URI,
        fetch,
      });
      const spotify = new SpotifyWebApi({
        tokens: {
          get: (forceRefresh) => getValidSpotifyAccessToken({
            userId: input.userId,
            repository: accounts,
            encryptionKey: env.TOKEN_ENCRYPTION_KEY,
            spotify: oauth,
            forceRefresh,
          }),
        },
        onAuthInvalid: clearSession,
      });
      const service = createSyncService({
        spotify,
        classifications: createDrizzleClassificationRepository(),
        playlists: createDrizzleGeneratedPlaylistRepository(),
        runs: createDrizzleSyncRunRepository(),
        now: () => new Date(),
      });
      return service.syncLibrary(input);
    },
    latestResult: async (userId) => createSyncService({
      spotify: {} as SpotifyWebApiPort,
      classifications: createDrizzleClassificationRepository(),
      playlists: createDrizzleGeneratedPlaylistRepository(),
      runs: createDrizzleSyncRunRepository(),
      now: () => new Date(),
    }).loadLatestSyncResult(userId),
    clearSession,
  });
}
