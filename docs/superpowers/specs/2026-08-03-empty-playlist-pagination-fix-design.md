# Empty Playlist Pagination Compatibility Fix

**Date:** 2026-08-03

**Status:** Approved for documentation on 2026-08-03

## Problem

The first live sorting run created and persisted all five managed mood playlists, then failed before adding tracks. Spotify returned HTTP 200 for the first newly created playlist with an empty pagination envelope:

- `items: []`
- `limit: 0`
- `offset: 0`
- `total: 0`
- `next: null`

The shared Spotify page schema currently requires `limit` to be at least 1. It therefore converts this valid empty response into `SPOTIFY_RESPONSE_INVALID`, even though the page is terminal and makes no pagination claim.

## Decision

Allow pagination envelopes to report an integer `limit` from 0 through 50. This is the smallest change that accepts Spotify's observed empty-playlist response without normalizing or discarding upstream data.

The existing pagination invariants remain authoritative:

- returned item count cannot exceed the reported limit;
- offsets cannot repeat;
- totals cannot be smaller than the returned range; and
- a zero-progress page that claims more data and supplies a continuation is rejected.

As a result, `limit: 0` is accepted for a terminal empty page but does not permit an infinite loop or an oversized result.

## Alternatives Considered

### Normalize `limit: 0` to the requested page size

Rejected because it replaces a real upstream value with a synthetic one and adds transformation behavior that the synchronization algorithm does not need.

### Skip playlist-item reads for playlists created in the same run

Rejected because the service would then have separate synchronization paths for created and reused playlists. Reading the actual destination remains the safer idempotent behavior after ambiguous or interrupted prior writes.

### Remove limit validation

Rejected because integer and upper-bound validation still protect pagination correctness.

## Data Flow

1. The synchronization service resolves or creates each managed playlist.
2. It requests the playlist's current items.
3. The Spotify client validates the page envelope, including a nonnegative limit no greater than 50.
4. An empty terminal page becomes an empty existing-URI set.
5. The service computes all classified URIs as missing and adds them in batches of at most 100.

The five mappings already persisted by the failed run remain reusable, so retrying after the fix must not create duplicate playlists.

## Error Handling

Malformed envelopes continue to produce `SPOTIFY_RESPONSE_INVALID`. The fix does not change authentication, permission, rate-limit, retry, token, logging, or public error-message behavior.

## Testing

Add a focused Spotify client regression test using the observed empty response with `limit: 0`. The test must fail before the production change and pass afterward.

Retain coverage proving that negative limits, limits above 50, repeated offsets, oversized pages, and no-progress pagination are rejected. Run the focused Spotify client tests, the full unit suite, lint, type checking, PostgreSQL integration tests, the production build, and an independent review before release.

## Scope

This change is limited to the Spotify pagination envelope and its regression coverage. It does not alter mood classification, playlist naming, database mappings, sync counts, or dashboard presentation.
