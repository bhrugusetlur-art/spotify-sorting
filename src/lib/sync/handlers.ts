import "server-only";
import { toErrorCode, type ErrorCode } from "@/lib/errors";
import type { LinkedAccount } from "@/lib/auth/repository";
import type { SyncResult } from "./result";

type SyncAccount = Pick<LinkedAccount, "userId" | "spotifyUserId">;

export type SyncHandlerDependencies = {
  currentAccount: () => Promise<SyncAccount | null>;
  syncLibrary: (input: { userId: string; spotifyUserId: string }) => Promise<SyncResult>;
  latestResult: (userId: string) => Promise<SyncResult | null>;
  clearSession: () => void | Promise<void>;
};

export type SyncHandlers = {
  post(): Promise<Response>;
  latest(): Promise<Response>;
};

export function createSyncHandlers(dependencies: SyncHandlerDependencies): SyncHandlers {
  return {
    post: async () => {
      try {
        const account = await dependencies.currentAccount();
        if (account === null) return unauthorizedResponse(dependencies);
        const result = await dependencies.syncLibrary({ userId: account.userId, spotifyUserId: account.spotifyUserId });
        return result.run.status === "succeeded"
          ? Response.json(publicResult(result))
          : await resultFailureResponse(result, dependencies);
      } catch (error) {
        return errorResponse(error, dependencies);
      }
    },
    latest: async () => {
      try {
        const account = await dependencies.currentAccount();
        if (account === null) return unauthorizedResponse(dependencies);
        const result = await dependencies.latestResult(account.userId);
        return Response.json(result === null ? { run: null, playlists: [] } : publicResult(result));
      } catch (error) {
        return errorResponse(error, dependencies);
      }
    },
  };
}

async function unauthorizedResponse(dependencies: SyncHandlerDependencies): Promise<Response> {
  await clearSession(dependencies);
  return failureResponse("AUTH_REQUIRED");
}

async function resultFailureResponse(result: SyncResult, dependencies: SyncHandlerDependencies): Promise<Response> {
  const code = result.run.failure?.code ?? "INTERNAL_ERROR";
  if (code === "AUTH_REQUIRED") await clearSession(dependencies);
  return Response.json({ error: safeError(code), ...publicResult(result) }, { status: statusFor(code) });
}

async function errorResponse(error: unknown, dependencies: SyncHandlerDependencies): Promise<Response> {
  const code = toErrorCode(error);
  if (code === "AUTH_REQUIRED") await clearSession(dependencies);
  return failureResponse(code);
}

function failureResponse(code: ErrorCode): Response {
  return Response.json({ error: safeError(code) }, { status: statusFor(code) });
}

function safeError(code: ErrorCode) {
  return {
    code,
    message: messages[code],
  };
}

function publicResult(result: SyncResult) {
  return {
    run: {
      id: result.run.id,
      status: result.run.status,
      counts: { ...result.run.counts },
      failure: result.run.failure === null ? null : { ...result.run.failure },
      startedAt: result.run.startedAt.toISOString(),
      completedAt: result.run.completedAt?.toISOString() ?? null,
    },
    playlists: result.playlists.map((playlist) => ({ ...playlist })),
  };
}

function statusFor(code: ErrorCode): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "SYNC_ALREADY_RUNNING") return 409;
  if (code === "SPOTIFY_RATE_LIMITED") return 429;
  if (spotifyFailureCodes.has(code)) return 502;
  return 500;
}

async function clearSession(dependencies: SyncHandlerDependencies): Promise<void> {
  try {
    await dependencies.clearSession();
  } catch {
    // Cookie clearing cannot make a safe HTTP response unsafe.
  }
}

const spotifyFailureCodes = new Set<ErrorCode>([
  "SPOTIFY_PERMISSION_DENIED",
  "SPOTIFY_RESPONSE_INVALID",
  "SPOTIFY_UNAVAILABLE",
  "PLAYLIST_SYNC_FAILED",
]);

const messages: Record<ErrorCode, string> = {
  AUTH_REQUIRED: "Please reconnect your Spotify account and try again.",
  AUTH_STATE_INVALID: "Please reconnect your Spotify account and try again.",
  SPOTIFY_PERMISSION_DENIED: "Spotify did not grant the permissions needed to sort your music.",
  SPOTIFY_RATE_LIMITED: "Spotify is rate limiting requests. Please try again shortly.",
  SPOTIFY_RESPONSE_INVALID: "Spotify returned an unexpected response. Please try again.",
  SPOTIFY_UNAVAILABLE: "Spotify could not complete the sorting request. Please try again.",
  PLAYLIST_SYNC_FAILED: "Spotify could not complete the sorting request. Please try again.",
  SYNC_ALREADY_RUNNING: "A sorting run is already in progress.",
  SYNC_INTERRUPTED: "This sorting run was interrupted by a newer request.",
  CONFIGURATION_INVALID: "The sorting service is temporarily unavailable.",
  INTERNAL_ERROR: "We could not sort your music. Please try again.",
};
