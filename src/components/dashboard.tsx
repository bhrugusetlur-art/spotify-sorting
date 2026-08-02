const moods = ["Chill", "Hype", "Focus", "Sad", "Happy"] as const;

export function Dashboard({ account }: { account: { displayName: string | null; imageUrl: string | null } }) {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-14">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-emerald-400">Connected as {account.displayName ?? "Spotify user"}</p>
          <h1 className="mt-3 text-4xl font-bold">Your mood playlists</h1>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="rounded-full border border-zinc-700 px-4 py-2">Log out</button>
        </form>
      </div>
      <section aria-label="Mood destinations" className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {moods.map((mood) => (
          <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5" key={mood}>
            <h2 className="font-semibold">{mood}</h2>
            <p className="mt-2 text-sm text-zinc-400">Ready for sorting</p>
          </article>
        ))}
      </section>
      <button disabled className="mt-10 rounded-full bg-emerald-400 px-6 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-50">
        Sort My Music
      </button>
      <p className="mt-3 text-sm text-zinc-400">The sorting engine is the next implementation slice.</p>
    </main>
  );
}
