import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const moodValues = ["chill", "hype", "focus", "sad", "happy"] as const;
export const mood = pgEnum("mood", moodValues);
export const syncStatus = pgEnum("sync_status", ["running", "succeeded", "failed"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  spotifyAccountId: text("spotify_account_id").unique(),
  spotifyUserId: text("spotify_user_id").notNull().unique(),
  displayName: text("display_name"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const spotifyAccounts = pgTable("spotify_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  scopes: text("scopes").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const generatedPlaylists = pgTable(
  "generated_playlists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mood: mood("mood").notNull(),
    spotifyPlaylistId: text("spotify_playlist_id").notNull(),
    playlistName: text("playlist_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("generated_playlists_user_mood_unique").on(table.userId, table.mood)],
);

export const songClassifications = pgTable(
  "song_classifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spotifyTrackId: text("spotify_track_id").notNull(),
    mood: mood("mood").notNull(),
    classifierVersion: text("classifier_version").notNull(),
    reason: text("reason").notNull(),
    metadataFingerprint: text("metadata_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("song_classifications_user_track_version_unique").on(
      table.userId,
      table.spotifyTrackId,
      table.classifierVersion,
    ),
  ],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaseToken: uuid("lease_token"),
    status: syncStatus("status").notNull(),
    totalCount: integer("total_count").default(0).notNull(),
    classifiedCount: integer("classified_count").default(0).notNull(),
    addedCount: integer("added_count").default(0).notNull(),
    skippedCount: integer("skipped_count").default(0).notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sync_runs_one_running_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'running'`),
    index("sync_runs_user_started_at_idx").on(table.userId, table.startedAt),
  ],
);
