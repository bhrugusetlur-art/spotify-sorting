export const errorCodes = [
  "AUTH_REQUIRED",
  "AUTH_STATE_INVALID",
  "SPOTIFY_PERMISSION_DENIED",
  "SPOTIFY_RATE_LIMITED",
  "SPOTIFY_UNAVAILABLE",
  "PLAYLIST_SYNC_FAILED",
  "CONFIGURATION_INVALID",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class AppError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "AppError";
  }
}

export function toErrorCode(error: unknown): ErrorCode {
  return error instanceof AppError ? error.code : "INTERNAL_ERROR";
}
