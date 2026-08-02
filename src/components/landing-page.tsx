const messages: Record<string, string> = {
  AUTH_STATE_INVALID: "The Spotify login expired. Please try again.",
  SPOTIFY_PERMISSION_DENIED: "Spotify permission was not granted. You can try again when ready.",
  SPOTIFY_RATE_LIMITED: "Spotify is receiving too many requests. Please wait and try again.",
  SPOTIFY_UNAVAILABLE: "Spotify is temporarily unavailable. Please try again.",
  INTERNAL_ERROR: "We could not complete the login. Please try again.",
};

export function LandingPage({ errorCode }: { errorCode?: string }) {
  const message = errorCode ? messages[errorCode] ?? messages.INTERNAL_ERROR : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-10 px-6 py-16">
      <p className="font-semibold text-emerald-400">Mood Sorter</p>
      <h1 className="max-w-3xl text-5xl font-bold tracking-tight">Sort your liked songs by mood.</h1>
      <p className="max-w-2xl text-lg text-zinc-300">
        Connect Spotify once. Mood Sorter will build five stable playlists without duplicating songs on later runs.
      </p>
      {message ? (
        <p role="alert" className="rounded-xl border border-red-900 bg-red-950 p-4 text-red-100">
          {message}
        </p>
      ) : null}
      <a className="w-fit rounded-full bg-emerald-400 px-6 py-3 font-bold text-black" href="/api/auth/spotify/start">
        Connect Spotify
      </a>
    </main>
  );
}
