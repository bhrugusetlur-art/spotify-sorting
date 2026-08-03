import { describe, expect, it } from "vitest";
import { createMemoryClassificationRepository } from "./classification-repository";

const classification = {
  spotifyTrackId: "track-1",
  mood: "chill" as const,
  classifierVersion: "metadata-v1" as const,
  reason: "Matched calm in title.",
  metadataFingerprint: "fingerprint-1",
};

describe("memory classification repository", () => {
  it("replaces a classification for the same user, track, and classifier version", async () => {
    const repository = createMemoryClassificationRepository();

    await repository.upsert("user-1", classification);
    await repository.upsert("user-1", {
      ...classification,
      mood: "focus",
      reason: "Matched study in title.",
      metadataFingerprint: "fingerprint-2",
    });

    await expect(repository.find("user-1", "track-1", "metadata-v1")).resolves.toEqual({
      ...classification,
      mood: "focus",
      reason: "Matched study in title.",
      metadataFingerprint: "fingerprint-2",
    });
  });

  it("keeps classifications isolated by user and classifier version", async () => {
    const repository = createMemoryClassificationRepository();
    await repository.upsert("user-1", classification);
    await repository.upsert("user-2", { ...classification, mood: "happy" });

    await expect(repository.find("user-1", "track-1", "metadata-v1")).resolves.toEqual(classification);
    await expect(repository.find("user-2", "track-1", "metadata-v1")).resolves.toEqual({ ...classification, mood: "happy" });
    await expect(repository.find("user-1", "track-1", "metadata-v2")).resolves.toBeNull();
  });
});
