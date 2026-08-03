ALTER TABLE "sync_runs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "spotify_account_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_one_running_per_user" ON "sync_runs" USING btree ("user_id") WHERE "sync_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "sync_runs_user_started_at_idx" ON "sync_runs" USING btree ("user_id","started_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_spotify_account_id_unique" UNIQUE("spotify_account_id");