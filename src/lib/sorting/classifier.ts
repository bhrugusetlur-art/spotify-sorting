import { createHash } from "node:crypto";
import { fingerprintTrack, normalizeText } from "./normalize";
import { MOODS, type Mood, type NormalizedTrack, type TrackClassification } from "./types";

export const CLASSIFIER_VERSION = "metadata-v1";

const keywords: Record<Mood, readonly string[]> = {
  chill: ["chill", "calm", "relax", "mellow", "ambient", "acoustic", "sunset", "sleep"],
  hype: ["hype", "party", "anthem", "workout", "rage", "pump", "dance", "club"],
  focus: ["focus", "study", "concentration", "instrumental", "piano", "coding", "work", "lofi", "lo-fi"],
  sad: ["sad", "heartbreak", "lonely", "tears", "goodbye", "lost", "blue", "broken"],
  happy: ["happy", "joy", "smile", "sunshine", "celebration", "uplifting", "cheerful", "good vibes"],
};

type Field = { name: "track name" | "album name" | "artist name"; text: string; weight: number };
type Match = { field: Field["name"]; term: string };
type Score = { value: number; matches: Match[] };

export function classifyTrack(track: NormalizedTrack): TrackClassification {
  const scores = scoreTrack(track);
  const winner = winningMood(scores);

  return winner === null
    ? fallbackClassification(track)
    : {
      spotifyTrackId: track.id,
      mood: winner,
      classifierVersion: CLASSIFIER_VERSION,
      reason: scores[winner].matches.map((match) => `${match.field}: ${match.term}`).join("; "),
      metadataFingerprint: fingerprintTrack(track),
    };
}

function scoreTrack(track: NormalizedTrack): Record<Mood, Score> {
  const scores: Record<Mood, Score> = {
    chill: { value: 0, matches: [] },
    hype: { value: 0, matches: [] },
    focus: { value: 0, matches: [] },
    sad: { value: 0, matches: [] },
    happy: { value: 0, matches: [] },
  };

  for (const field of fieldsFor(track)) {
    for (const mood of MOODS) {
      for (const term of keywords[mood]) {
        if (!matchesTerm(field.text, term)) continue;

        scores[mood].value += field.weight;
        scores[mood].matches.push({ field: field.name, term });
      }
    }
  }

  return scores;
}

function fieldsFor(track: NormalizedTrack): Field[] {
  return [
    { name: "track name", text: normalizeText(track.normalizedName), weight: 3 },
    { name: "album name", text: normalizeText(track.normalizedAlbumName), weight: 2 },
    ...track.artists.map((artist) => ({ name: "artist name" as const, text: normalizeText(artist.normalizedName), weight: 1 })),
  ];
}

function matchesTerm(text: string, term: string): boolean {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapedTerm}(?=$|[^\\p{L}\\p{N}])`, "u").test(text);
}

function winningMood(scores: Record<Mood, Score>): Mood | null {
  let winner: Mood | null = null;
  let highestScore = 0;

  for (const mood of MOODS) {
    if (scores[mood].value > highestScore) {
      winner = mood;
      highestScore = scores[mood].value;
    }
  }

  return winner;
}

function fallbackClassification(track: NormalizedTrack): TrackClassification {
  const primaryArtistId = track.artists[0]?.id ?? "";
  const hash = createHash("sha256")
    .update(`${CLASSIFIER_VERSION}:${track.id}:${primaryArtistId}`, "utf8")
    .digest("hex");
  const mood = MOODS[Number.parseInt(hash.slice(0, 8), 16) % MOODS.length];

  return {
    spotifyTrackId: track.id,
    mood,
    classifierVersion: CLASSIFIER_VERSION,
    reason: "Stable metadata fallback.",
    metadataFingerprint: fingerprintTrack(track),
  };
}
