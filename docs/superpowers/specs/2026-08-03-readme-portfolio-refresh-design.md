# README Portfolio Refresh Design

**Date:** 2026-08-03

**Status:** Approved for implementation

## Goal

Turn the root README into a short, portfolio-first introduction inspired by the
structure of `bhrugusetlur-art/cpu-design`: lead with the result, show honest
project visuals, explain the core flow quickly, and keep setup available without
letting it dominate the page.

## README structure

The README will contain, in order:

1. `Mood Sorter` title and a one-sentence product pitch.
2. A real dashboard screenshot using representative test data.
3. A compact results table covering the five moods, deterministic
   classification, private playlists, and safe repeat runs.
4. A small Mermaid flow from Spotify login and saved tracks through
   classification to the five managed playlists.
5. A collapsed `Run locally` section with prerequisites, environment setup,
   migration, and development commands.
6. A compact verification command and one-line technology summary.

Long architecture, sorting-safety, verification, and security explanations will
be removed from the root README. The short feature descriptions and source tree
remain the detailed reference for those guarantees.

## Visuals

### Dashboard hero

- Create `docs/images/mood-sorter-dashboard.png` from the actual dashboard UI.
- Use deterministic representative account, playlist, and result data so no
  private Spotify or database information appears.
- Capture the successful post-sort state at a desktop README-friendly width.
- Caption it as representative test data rather than a live Spotify account.
- Do not add decorative UI or features that the application does not contain.

### Workflow diagram

Use a compact Mermaid left-to-right flow:

`Spotify login → liked songs → deterministic classifier → five private mood playlists`

Include a repeat-run path that communicates existing items are skipped. Keep
the diagram readable on GitHub without requiring a separate image asset.

## Content rules

- Lead with what the project does, not its implementation stack.
- Keep every section skimmable and avoid duplicating source-level details.
- Preserve these material claims: five private playlists, deterministic
  `metadata-v1` classification, additive/idempotent synchronization, safe
  retries, and server-side encrypted token storage.
- Do not claim that representative test data came from a live Spotify account.
- Retain enough setup detail for a developer to run the project after expanding
  one disclosure block.
- Keep secret-handling and disposable-database warnings beside the commands
  where they matter.

## Verification

- Render and inspect the dashboard screenshot for correct content, legibility,
  and absence of personal data.
- Confirm the screenshot path and every relative Markdown link resolve.
- Confirm the Mermaid source uses GitHub-supported syntax.
- Run the README-related browser or component test used to produce the visual.
- Run `git diff --check`.
- Review the final README at GitHub-like width for brevity and scan order.

## Out of scope

- Changing application behavior or visual design.
- Adding marketing claims, badges, deployment links, or live Spotify data.
- Reorganizing the wider documentation tree.
- Replacing detailed implementation documents with new README prose.
